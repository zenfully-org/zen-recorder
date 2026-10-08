/**
 * Video+audio encoder behind the same `Encoder` interface as the MediaRecorder one: composites
 * Meet's tiles on a canvas, encodes VP9/VP8 + Opus with WebCodecs and muxes live with Mediabunny
 * into an append-only WebM. Every byte is written sequentially, so the chunks concatenate into a
 * valid file exactly like MediaRecorder timeslices do.
 *
 * Clock: the audio graph's. Each audio buffer goes where the graph captured it, so audio
 * that reaches a busy page late and the device clock's drift add no silence; silence goes only
 * where the graph captured nothing (`createMediaClock`). Video frames get the file position of the
 * moment they are drawn from the same clock, so A/V stay aligned over hours, placed on the
 * track's frame grid so that no two of them share a timestamp (`createFrameGrid`).
 *
 * Pause, Resume and Stop take effect on the video at once and on the audio at the click's place in
 * the audio (`AudioTap.capture`): a busy page still has audio from before the click queued, which
 * goes into the file, and after a pause it has audio of the pause queued, which does not.
 */
import {
  AppendOnlyStreamTarget,
  AudioSample,
  AudioSampleSource,
  Output,
  VideoSample,
  VideoSampleSource,
  WebMOutputFormat,
} from 'mediabunny';
import type { AudioSamples, AudioTap } from '@/lib/page/create-audio-tap';
import type { ByteBatcher } from '@/lib/page/create-byte-batcher';
import { createGraphClock } from '@/lib/page/create-graph-clock';
import { createMediaClock, type MediaClock } from '@/lib/page/create-media-clock';
import type {
  EncodedChunk,
  Encoder,
  EncoderOptions,
} from '@/lib/page/create-media-recorder-encoder';
import type { FrameClock, FrameClockDeps } from '@/lib/video/create-frame-clock';
import { createFrameGrid } from '@/lib/video/create-frame-grid';
import type { FrameStats } from '@/lib/video/create-frame-stats';
import type { TileCompositor } from '@/lib/video/create-tile-compositor';
import type { VideoPlan } from '@/lib/video/pick-video-plan';

export interface WebCodecsEncoderDeps {
  plan: VideoPlan;
  compositor: TileCompositor;
  /** Receives the cost of every tick (see `createFrameStats`). */
  stats: FrameStats;
  createClock: (onTick: FrameClockDeps['onTick']) => FrameClock;
  createAudioTap: (stream: MediaStream, onSamples: (samples: AudioSamples) => void) => AudioTap;
  createBatcher: (
    options: { maxMs: number; mimeType: string },
    onChunk: (chunk: EncodedChunk) => void,
  ) => ByteBatcher;
  now: () => number;
  onChunk: (chunk: EncodedChunk) => void;
  onError: (error: Error) => void;
  /** Informational lines for the diagnostics log (e.g. which audio capture path is in use). */
  onLog?: (message: string) => void;
  /** Buffers the muxer may still owe before new audio is dropped (default 2000). */
  maxPendingAudio?: number;
}

interface Session {
  output: Output;
  video: VideoSampleSource;
  audio: AudioSampleSource;
  ready: Promise<void>;
  tap: AudioTap;
  /** Where audio buffers and this moment go in the file. */
  timeline: MediaClock;
  clock: FrameClock;
  batcher: ByteBatcher;
}

/** Buffers the muxer may still owe before new audio is dropped (≈ 90 s of 43 ms worklet buffers). */
const MAX_PENDING_AUDIO = 2000;
/** Silence shorter than this is not worth a diagnostics line (a pause's edges). */
const GAP_LOG_S = 0.05;
/** How often the audio clock line goes to the diagnostics log while recording (and at Stop). */
const CLOCK_LOG_MS = 60_000;

export function createWebCodecsEncoder(deps: WebCodecsEncoderDeps): Encoder {
  const { plan, compositor } = deps;
  const maxPendingAudio = deps.maxPendingAudio ?? MAX_PENDING_AUDIO;
  const mimeType = `video/webm;codecs=${plan.codec},opus`;
  let state: RecordingState = 'inactive';
  let session: Session | null = null;
  let stopped: Promise<void> | null = null;
  let failed = false;

  // Timeline bookkeeping.
  let audioFrames = 0;
  let sampleRate = 0;
  let silenceTotal = 0;
  let pendingAudio = 0;
  let droppedAudio = 0;
  let startedWall = 0;
  let pausedSince = 0;
  let pausedTotal = 0;
  let nextClockLog = 0;
  const grid = createFrameGrid(plan.fps);
  let audioChain: Promise<void> = Promise.resolve();

  const fail = (error: unknown): void => {
    if (failed) return;
    failed = true;
    deps.onError(error instanceof Error ? error : new Error(String(error)));
  };

  /** Recording time on the wall clock, pauses left out (seconds). */
  const wallSeconds = (): number =>
    ((state === 'paused' ? pausedSince : deps.now()) - startedWall - pausedTotal) / 1000;

  /**
   * How far the audio in the file is behind the recording at `wall` and `media` seconds, by the
   * wall clock and by the graph's: the gap between the two is the device clock's drift.
   */
  const clockLine = (wall: number, media: number): string => {
    const written = sampleRate > 0 ? audioFrames / sampleRate : 0;
    return `audio clock: deficit_wall ${(wall - written).toFixed(3)} s, deficit_graph ${(media - written).toFixed(3)} s, gaps filled ${silenceTotal.toFixed(2)} s`;
  };

  /** Queues `write` for the muxer, after everything queued before it. */
  const enqueue = (current: Session, write: () => Promise<void>): void => {
    pendingAudio++;
    audioChain = audioChain
      .then(async () => {
        await current.ready;
        await write();
      })
      .catch(fail)
      .finally(() => {
        pendingAudio--;
      });
  };

  const addSample = async (
    current: Session,
    data: Float32Array,
    rate: number,
    timestamp: number,
  ): Promise<void> => {
    const sample = new AudioSample({
      data,
      format: 'f32',
      numberOfChannels: 1,
      sampleRate: rate,
      timestamp,
    });
    try {
      await current.audio.add(sample);
    } finally {
      sample.close();
    }
  };

  /** Adds `data` at the end of the file's audio. */
  const writeAudio = (current: Session, data: Float32Array, rate: number): void => {
    const timestamp = audioFrames / rate;
    audioFrames += data.length;
    sampleRate = rate;
    enqueue(current, () => addSample(current, data, rate, timestamp));
  };

  /** Adds `frames` of silence, made a second at a time when its turn comes: a long stop costs no memory. */
  const writeSilence = (current: Session, frames: number, rate: number): void => {
    const timestamp = audioFrames / rate;
    audioFrames += frames;
    sampleRate = rate;
    enqueue(current, async () => {
      for (let done = 0; done < frames; done += rate) {
        const length = Math.min(rate, frames - done);
        await addSample(current, new Float32Array(length), rate, timestamp + done / rate);
      }
    });
  };

  /**
   * Writes a buffer of the recording where the clock places it: cut at the gaps it names, which
   * are filled with silence and named in the log (the one before the first buffer as the start).
   */
  const writeLive = (current: Session, samples: AudioSamples): void => {
    const { data, sampleRate: rate } = samples;
    const first = audioFrames === 0;
    const gaps = current.timeline.place(
      { frame: samples.frame, frames: data.length, sampleRate: rate },
      audioFrames / rate,
    );
    let from = 0;
    for (const gap of gaps) {
      if (gap.offset > from) writeAudio(current, data.slice(from, gap.offset), rate);
      const frames = Math.round(gap.seconds * rate);
      if (frames > 0) writeSilence(current, frames, rate);
      silenceTotal += frames / rate;
      from = gap.offset;
    }
    writeAudio(current, from === 0 ? data : data.slice(from), rate);
    const lead = gaps[0]?.offset === 0 ? gaps[0].seconds : 0;
    if (first) deps.onLog?.(`audio starts ${lead.toFixed(2)} s into the recording`);
    for (const gap of gaps) {
      if (gap.seconds < GAP_LOG_S || (first && gap.offset === 0)) continue;
      deps.onLog?.(
        `audio gap of ${gap.seconds.toFixed(2)} s filled with silence (${silenceTotal.toFixed(1)} s so far)`,
      );
    }
    if (deps.now() >= nextClockLog) {
      deps.onLog?.(clockLine(wallSeconds(), current.timeline.now()));
      nextClockLog = deps.now() + CLOCK_LOG_MS;
    }
  };

  const onSamples = (samples: AudioSamples): void => {
    const current = session;
    if (!current || failed) return;
    if (pendingAudio >= maxPendingAudio) {
      // The muxer has not accepted audio for minutes: keep memory bounded rather than the audio.
      if (droppedAudio === 0) deps.onLog?.('audio backlog too large; dropping buffers');
      droppedAudio++;
      return;
    }
    // Paused or stopping: audio from before the click, late but complete (see `AudioTap.capture`).
    if (state === 'recording') writeLive(current, samples);
    else writeAudio(current, samples.data, samples.sampleRate);
  };

  /**
   * One frame: composite, snapshot the canvas into a `VideoFrame` (inside `VideoSample`), hand it
   * to the encoder and wait for its backpressure. Each step is timed for the adaptive rate.
   */
  const onTick: FrameClockDeps['onTick'] = async ({ now, forced }) => {
    const current = session;
    if (!current || state !== 'recording' || failed) return false;
    deps.stats.tick(now);
    // Every tick reads the clocks, drawn or not: frequent readings keep the graph clock's bounds
    // tight. A tick whose slot of the grid is behind the last frame's draws nothing.
    if (grid.isAhead(current.timeline.now())) return false;
    const drawn = await compositor.drawFrame({ force: forced });
    if (!drawn.drawn) {
      deps.stats.unchanged(now);
      return false;
    }
    try {
      await current.ready;
      const framing = deps.now();
      const sample = new VideoSample(compositor.canvas, {
        timestamp: grid.place(current.timeline.now()),
        duration: 1 / plan.fps,
      });
      const encoding = deps.now();
      const added = current.video.add(sample);
      const waiting = deps.now();
      try {
        await added;
      } finally {
        sample.close();
      }
      const done = deps.now();
      deps.stats.frame(done, {
        find: drawn.findMs,
        layout: drawn.layoutMs,
        draw: drawn.drawMs,
        frame: encoding - framing,
        encode: waiting - encoding,
        wait: drawn.snapshotWaitMs + (done - waiting),
      });
    } catch (error) {
      fail(error);
      return false;
    }
    return true;
  };

  return {
    mimeType: () => mimeType,
    state: () => state,
    start(stream, options: EncoderOptions) {
      if (session) throw new Error('encoder already started');
      const timesliceSeconds = options.timesliceMs / 1000;
      const batcher = deps.createBatcher({ maxMs: options.timesliceMs, mimeType }, deps.onChunk);
      const output = new Output({
        format: new WebMOutputFormat({
          appendOnly: true,
          minimumClusterDuration: timesliceSeconds,
        }),
        target: new AppendOnlyStreamTarget(
          new WritableStream<Uint8Array>({ write: (bytes) => batcher.write(bytes) }),
        ),
      });
      const video = new VideoSampleSource({
        codec: plan.codec,
        bitrate: plan.bitsPerSecond,
        keyFrameInterval: timesliceSeconds,
        latencyMode: 'realtime',
        sizeChangeBehavior: 'deny',
      });
      const audio = new AudioSampleSource({ codec: 'opus', bitrate: options.audioBitsPerSecond });
      // The muxer rounds every video timestamp to this rate's grid, the one `grid` places frames on.
      output.addVideoTrack(video, { frameRate: plan.fps });
      output.addAudioTrack(audio);
      const ready = output.start().catch(fail);
      startedWall = deps.now();
      nextClockLog = startedWall + CLOCK_LOG_MS;
      state = 'recording';
      const tap = deps.createAudioTap(stream, onSamples);
      const timeline = createMediaClock({
        graph: createGraphClock({ now: () => deps.now() / 1000, graphTime: () => tap.graphTime() }),
      });
      const next: Session = {
        output,
        video,
        audio,
        ready,
        tap,
        timeline,
        clock: deps.createClock(onTick),
        batcher,
      };
      session = next;
      next.clock.start();
      void next.tap.ready.then(() => deps.onLog?.(`audio tap: ${next.tap.kind()}`));
    },
    pause() {
      if (state !== 'recording') return;
      state = 'paused';
      pausedSince = deps.now();
      session?.timeline.pause();
      void session?.tap.capture(false);
    },
    resume() {
      if (state !== 'paused') return;
      state = 'recording';
      pausedTotal += deps.now() - pausedSince;
      session?.timeline.resume();
      void session?.tap.capture(true);
    },
    stop() {
      const current = session;
      if (!current) return Promise.resolve();
      stopped ??= (async () => {
        const wallAtStop = wallSeconds();
        const mediaAtStop = current.timeline.now();
        state = 'inactive';
        current.clock.stop();
        await current.tap.capture(false);
        current.tap.dispose();
        await audioChain;
        deps.onLog?.(clockLine(wallAtStop, mediaAtStop));
        try {
          await current.ready;
          await current.output.finalize();
        } catch (error) {
          fail(error);
        }
        current.batcher.close();
      })();
      return stopped;
    },
    flush() {
      session?.batcher.flush();
    },
  };
}
