import { ALL_FORMATS, type AudioSample, AudioSampleSource, BlobSource, Input } from 'mediabunny';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFrameClock } from '@/lib/video/create-frame-clock';
import { createFrameStats } from '@/lib/video/create-frame-stats';
import { createTileCompositor, type TileCompositor } from '@/lib/video/create-tile-compositor';
import type { VideoPlan } from '@/lib/video/pick-video-plan';
import {
  createFakeAudioContext,
  type FakeAudioContext,
} from '@/test/fakes/create-fake-audio-context';
import { createFakeCanvas } from '@/test/fakes/create-fake-canvas';
import { createFakeOffscreenCanvas } from '@/test/fakes/create-fake-offscreen-canvas';
import { registerFakeMediabunnyEncoders } from '@/test/fakes/register-fake-mediabunny-encoders';
import { readVideoTimestamps } from '@/test/read-video-timestamps';
import { createAudioTap } from './create-audio-tap';
import { createByteBatcher } from './create-byte-batcher';
import type { EncodedChunk } from './create-media-recorder-encoder';
import { createWebCodecsEncoder } from './create-webcodecs-encoder';

const plan: VideoPlan = {
  codec: 'vp9',
  width: 320,
  height: 180,
  fps: 10,
  bitsPerSecond: 500_000,
  labels: false,
};
const fakes = registerFakeMediabunnyEncoders();

function setup(
  options: {
    plan?: VideoPlan;
    drawEvery?: boolean;
    writeFails?: boolean;
    withLog?: boolean;
    /** What the compositor reports as time spent waiting for snapshots. */
    snapshotWaitMs?: number;
    maxPendingAudio?: number;
    /** Capture through the AudioWorklet (its real processor) instead of the ScriptProcessor. */
    worklet?: boolean;
    /** How long each drawn frame takes to draw, in draw order (ms); 0 past the end. */
    drawMs?: readonly number[];
  } = {},
) {
  vi.useFakeTimers();
  vi.setSystemTime(1_000_000);
  vi.stubGlobal('OffscreenCanvas', createFakeOffscreenCanvas());
  fakes.reset();
  const canvas = createFakeCanvas();
  let frame = 0;
  const real = createTileCompositor({
    createCanvas: () => canvas.canvas,
    size: { width: plan.width, height: plan.height },
    viewport: () => ({ width: 100, height: 100 }),
    labels: false,
    findTiles: () => [],
    layout: () => [],
    // A changing signature makes every tick draw; a constant one only draws on heartbeat.
    signature: () => (options.drawEvery === false ? 'static' : `f${frame++}`),
    draw: () => undefined,
    snapshot: async () => null,
    frameKeys: () => (tile) => tile.frameKey,
    now: () => Date.now(),
  });
  let draws = 0;
  const compositor: TileCompositor = {
    ...real,
    drawFrame: async (draw) => {
      const drawn = await real.drawFrame(draw);
      const ms = options.drawMs?.[draws++] ?? 0;
      if (ms > 0) await new Promise((resolve) => window.setTimeout(resolve, ms));
      return { ...drawn, snapshotWaitMs: options.snapshotWaitMs ?? 0 };
    },
  };
  const context = createFakeAudioContext({ worklet: options.worklet ?? false });
  const chunks: EncodedChunk[] = [];
  const errors: Error[] = [];
  const logs: string[] = [];
  const stats = createFrameStats();
  const encoder = createWebCodecsEncoder({
    plan: options.plan ?? plan,
    compositor,
    stats,
    createClock: (onTick) =>
      createFrameClock({
        fps: plan.fps,
        heartbeatMs: 2000,
        setInterval: (handler, ms) => window.setInterval(handler, ms),
        clearInterval: (id) => window.clearInterval(id),
        now: () => Date.now(),
        onTick,
        onError: (e) => errors.push(e),
      }),
    createAudioTap: (stream, onSamples) =>
      createAudioTap({
        context: context as unknown as AudioContext,
        stream,
        onSamples,
        ...(options.worklet
          ? {
              AudioWorkletNode: context.AudioWorkletNode,
              createObjectURL: (blob: Blob) => context.createObjectURL(blob),
            }
          : {}),
        setTimeout: (handler, ms) => window.setTimeout(handler, ms),
        clearTimeout: (id) => window.clearTimeout(id),
      }),
    createBatcher: ({ maxMs, mimeType }, onChunk) =>
      options.writeFails
        ? {
            write: () => {
              throw new Error('disk full');
            },
            flush: () => undefined,
            close: () => undefined,
            bufferedBytes: () => 0,
          }
        : createByteBatcher({
            maxBytes: 64 * 1024,
            maxMs,
            mimeType,
            setTimeout: (handler, ms) => window.setTimeout(handler, ms),
            clearTimeout: (id) => window.clearTimeout(id),
            now: () => Date.now(),
            onChunk,
          }),
    now: () => Date.now(),
    onChunk: (c) => chunks.push(c),
    onError: (e) => errors.push(e),
    ...(options.withLog === false ? {} : { onLog: (m) => logs.push(m) }),
    ...(options.maxPendingAudio === undefined ? {} : { maxPendingAudio: options.maxPendingAudio }),
  });
  const audio = (context as FakeAudioContext).processors;
  // Feed 100 ms of audio per 100 ms of virtual time while running.
  const run = async (ms: number) => {
    for (let t = 0; t < ms; t += 100) {
      audio[0]?.emitAudio(new Float32Array(4800));
      await vi.advanceTimersByTimeAsync(100);
    }
  };
  /** Stops, letting the drain give up on a tap that receives nothing more (as Firefox would). */
  const stop = async () => {
    const stopped = encoder.stop();
    await vi.advanceTimersByTimeAsync(1000);
    await stopped;
  };
  return {
    encoder,
    chunks,
    errors,
    logs,
    run,
    stop,
    compositor,
    stats,
    context: context as FakeAudioContext,
  };
}

/** Feeds `seconds` of audio holding `value` through the worklet, 100 ms per 100 ms of time. */
async function render(context: FakeAudioContext, seconds: number, value: number) {
  for (let t = 0; t < seconds * 10; t++) {
    context.workletNodes[0]?.render(new Float32Array(4800).fill(value));
    await vi.advanceTimersByTimeAsync(100);
  }
}

/** Seconds of audio the encoder handed to the muxer, by sample value (0 is injected silence). */
function recordAudio() {
  const seconds = new Map<number, number>();
  const add = AudioSampleSource.prototype.add;
  const spy = vi.spyOn(AudioSampleSource.prototype, 'add').mockImplementation(function (
    this: AudioSampleSource,
    sample: AudioSample,
  ) {
    const data = new Float32Array(sample.numberOfFrames);
    sample.copyTo(data, { planeIndex: 0, format: 'f32' });
    for (const value of data) {
      const key = Math.round(value * 100) / 100;
      seconds.set(key, (seconds.get(key) ?? 0) + 1 / sample.sampleRate);
    }
    return add.call(this, sample);
  });
  return {
    /** Seconds per value, rounded to 10 ms. */
    seconds: (value: number) => Math.round((seconds.get(value) ?? 0) * 100) / 100,
    restore: () => spy.mockRestore(),
  };
}

/** The audio the encoder handed to the muxer, in order: runs of one sample value (0 is silence). */
function recordTimeline() {
  const runs: [number, number][] = [];
  let largest = 0;
  const add = AudioSampleSource.prototype.add;
  const spy = vi.spyOn(AudioSampleSource.prototype, 'add').mockImplementation(function (
    this: AudioSampleSource,
    sample: AudioSample,
  ) {
    const data = new Float32Array(sample.numberOfFrames);
    sample.copyTo(data, { planeIndex: 0, format: 'f32' });
    largest = Math.max(largest, sample.numberOfFrames);
    for (const value of data) {
      const key = Math.round(value * 100) / 100;
      const last = runs[runs.length - 1];
      if (last && last[0] === key) last[1] += 1 / sample.sampleRate;
      else runs.push([key, 1 / sample.sampleRate]);
    }
    return add.call(this, sample);
  });
  return {
    /** [value, seconds] in file order, seconds rounded to 10 ms. */
    runs: () => runs.map(([value, seconds]) => [value, Math.round(seconds * 100) / 100]),
    /** Frames in the largest sample handed over. */
    largest: () => largest,
    restore: () => spy.mockRestore(),
  };
}

async function parse(chunks: EncodedChunk[]) {
  const blob = new Blob(
    chunks.map((c) => c.blob),
    { type: 'video/webm' },
  );
  const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
  try {
    const tracks = await input.getTracks();
    const video = await input.getPrimaryVideoTrack();
    const audio = await input.getPrimaryAudioTrack();
    return {
      bytes: blob.size,
      tracks: tracks.map((t) => `${t.type}:${t.codec}`),
      duration: await input.computeDuration(),
      video: video
        ? {
            width: video.codedWidth,
            height: video.codedHeight,
            packets: (await video.computePacketStats()).packetCount,
            colorSpace: await video.getColorSpace(),
          }
        : null,
      audioPackets: audio ? (await audio.computePacketStats()).packetCount : 0,
      audioDuration: audio ? await audio.computeDuration() : 0,
    };
  } finally {
    input.dispose();
  }
}

describe('createWebCodecsEncoder', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('reports its mime type and state before starting', () => {
    const { encoder } = setup();
    expect(encoder.mimeType()).toBe('video/webm;codecs=vp9,opus');
    expect(encoder.state()).toBe('inactive');
    encoder.pause();
    encoder.resume();
    encoder.flush();
    expect(encoder.state()).toBe('inactive');
  });

  it('muxes video and audio into append-only WebM chunks that concatenate into a valid file', async () => {
    const { encoder, stop, chunks, errors, run } = setup();
    encoder.start(new MediaStream(), { audioBitsPerSecond: 64_000, timesliceMs: 1000 });
    expect(encoder.state()).toBe('recording');
    await run(3000);
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    await stop();
    await encoder.stop();
    expect(errors).toEqual([]);
    expect(encoder.state()).toBe('inactive');
    expect(chunks.map((c) => c.seq)).toEqual(chunks.map((_, i) => i));
    const first = new Uint8Array(await (chunks[0] as EncodedChunk).blob.arrayBuffer());
    expect(Array.from(first.slice(0, 4))).toEqual([0x1a, 0x45, 0xdf, 0xa3]);
    const file = await parse(chunks);
    expect(file.tracks).toEqual(['video:vp9', 'audio:opus']);
    expect(file.video).toMatchObject({ width: 320, height: 180 });
    expect(file.video?.packets).toBeGreaterThanOrEqual(25);
    expect(file.audioPackets).toBeGreaterThanOrEqual(25);
    expect(file.duration).toBeGreaterThanOrEqual(2.9);
    expect(file.duration).toBeLessThanOrEqual(3.2);
  });

  it('reports which audio capture path is in use, when asked', async () => {
    const { encoder, stop, logs, run } = setup();
    encoder.start(new MediaStream(), { audioBitsPerSecond: 64_000, timesliceMs: 1000 });
    await run(200);
    expect(logs.filter((line) => line.startsWith('audio tap'))).toEqual(['audio tap: processor']);
    await stop();
    const quiet = setup({ withLog: false });
    quiet.encoder.start(new MediaStream(), { audioBitsPerSecond: 64_000, timesliceMs: 1000 });
    await quiet.run(200);
    expect(quiet.logs).toEqual([]);
    await quiet.stop();
  });

  it('fills the time the audio graph did not run with silence so the file keeps the meeting length', async () => {
    const { encoder, stop, chunks, logs, context } = setup();
    encoder.start(new MediaStream(), { audioBitsPerSecond: 64_000, timesliceMs: 1000 });
    // A graph that only runs half of the time: 50 ms of audio per 100 ms of wall time.
    for (let t = 0; t < 6000; t += 100) {
      context.processors[0]?.emitAudio(new Float32Array(2400));
      await vi.advanceTimersByTimeAsync(100);
    }
    await stop();
    expect(logs.some((l) => l.includes('filled with silence'))).toBe(true);
    const file = await parse(chunks);
    expect(file.duration).toBeGreaterThanOrEqual(5);
    expect(file.duration).toBeLessThanOrEqual(6.2);
  });

  it('keeps audio that starts late in step with the recording clock', async () => {
    const { encoder, stop, chunks, logs, run } = setup();
    encoder.start(new MediaStream(), { audioBitsPerSecond: 64_000, timesliceMs: 1000 });
    // A context whose graph only starts six seconds after the recording.
    await vi.advanceTimersByTimeAsync(6000);
    await run(4000);
    await stop();
    expect(logs.filter((l) => l.startsWith('audio starts'))).toEqual([
      'audio starts 5.90 s into the recording',
    ]);
    const file = await parse(chunks);
    expect(file.duration).toBeGreaterThanOrEqual(9.5);
    expect(file.duration).toBeLessThanOrEqual(10.4);
  });

  it('does not inject silence for audio that arrives late but complete', async () => {
    const { encoder, stop, chunks, logs, context } = setup();
    encoder.start(new MediaStream(), { audioBitsPerSecond: 64_000, timesliceMs: 1000 });
    await vi.advanceTimersByTimeAsync(0);
    const processor = context.processors[0];
    if (!processor) throw new Error('no processor');
    // A stalled main thread: the graph renders 3 s, none of it reaches the page yet.
    processor.holdEvents = true;
    for (let t = 0; t < 3000; t += 100) {
      processor.emitAudio(new Float32Array(4800));
      await vi.advanceTimersByTimeAsync(100);
    }
    processor.holdEvents = false;
    processor.deliver();
    for (let t = 0; t < 2000; t += 100) {
      context.processors[0]?.emitAudio(new Float32Array(4800));
      await vi.advanceTimersByTimeAsync(100);
    }
    await stop();
    expect(logs.some((l) => l.includes('silence'))).toBe(false);
    const file = await parse(chunks);
    expect(file.duration).toBeGreaterThanOrEqual(4.9);
    expect(file.duration).toBeLessThanOrEqual(5.2);
  });

  it('drops audio buffers once the muxer backlog is unreasonably large', async () => {
    const stuck = vi
      .spyOn(AudioSampleSource.prototype, 'add')
      .mockImplementation(() => new Promise<void>(() => undefined));
    try {
      // Reaching the default limit (2000) took 2005 real buffers, seconds of CPU on a loaded
      // machine; a limit of 3 takes the same path.
      const { encoder, logs, context } = setup({ maxPendingAudio: 3 });
      encoder.start(new MediaStream(), { audioBitsPerSecond: 64_000, timesliceMs: 1000 });
      await vi.advanceTimersByTimeAsync(10);
      const emit = (count: number) => {
        for (let i = 0; i < count; i++) context.processors[0]?.emitAudio(new Float32Array(2048));
      };
      const backlogLogs = () => logs.filter((l) => l.includes('backlog'));
      emit(3); // the muxer owes 3 buffers: still accepted
      expect(backlogLogs()).toEqual([]);
      emit(1); // the first buffer past the limit is dropped, and logged
      expect(backlogLogs()).toEqual(['audio backlog too large; dropping buffers']);
      emit(2); // later drops are not logged again
      await vi.advanceTimersByTimeAsync(10);
      expect(backlogLogs()).toEqual(['audio backlog too large; dropping buffers']);
    } finally {
      stuck.mockRestore();
    }
  });

  describe('the audio clock', () => {
    it('does not fill audio that reaches a busy page late with silence', async () => {
      const audio = recordTimeline();
      try {
        const { encoder, stop, chunks, logs, context } = setup({ worklet: true });
        encoder.start(new MediaStream(), { audioBitsPerSecond: 64_000, timesliceMs: 1000 });
        await vi.advanceTimersByTimeAsync(0);
        const node = context.workletNodes[0];
        if (!node) throw new Error('no worklet node');
        await render(context, 1, 0.25);
        // Busy for 6 s: the page takes one buffer per 100 ms while the tap posts 2.3.
        node.holdMessages = true;
        for (let t = 0; t < 60; t++) {
          node.render(new Float32Array(4800).fill(0.5));
          node.deliver(1);
          await vi.advanceTimersByTimeAsync(100);
        }
        node.holdMessages = false;
        node.deliver();
        await render(context, 2, 0.75);
        await stop();
        expect(logs.filter((line) => line.includes('filled with silence'))).toEqual([]);
        expect(audio.runs()).toEqual([
          [0.25, 1],
          [0.5, 6],
          [0.75, 2],
        ]);
        expect((await parse(chunks)).audioDuration).toBeCloseTo(9, 1);
      } finally {
        audio.restore();
      }
    });

    it('follows the audio device clock: its drift from wall time is not filled with silence', async () => {
      const { encoder, stop, chunks, logs, context } = setup({ worklet: true, drawEvery: false });
      encoder.start(new MediaStream(), { audioBitsPerSecond: 64_000, timesliceMs: 1000 });
      await vi.advanceTimersByTimeAsync(0);
      // The device clock runs 0.5 % slow (99.5 ms of audio per 100 ms of wall time) for 90 s:
      // a real device's 0.01 % over hours, compressed.
      for (let t = 0; t < 900; t++) {
        context.workletNodes[0]?.render(new Float32Array(4776).fill(0.5));
        await vi.advanceTimersByTimeAsync(100);
      }
      await stop();
      expect(logs.filter((line) => line.includes('filled with silence'))).toEqual([]);
      expect((await parse(chunks)).audioDuration).toBeCloseTo(89.55, 1);
      // A minute in and at Stop: behind the wall clock by the drift, not behind the graph's.
      const deficits = logs
        .filter((line) => line.startsWith('audio clock'))
        .map((line) => [...line.matchAll(/(-?[\d.]+) s/g)].map((match) => Number(match[1])));
      expect(deficits).toHaveLength(2);
      const [minute, atStop] = deficits;
      expect(minute?.[0]).toBeCloseTo(0.3, 1);
      expect(atStop?.[0]).toBeCloseTo(0.45, 1);
      // Within one reading of the graph clock (the fake renders 100 ms at a time).
      expect(Math.abs(minute?.[1] ?? 1)).toBeLessThan(0.15);
      expect(Math.abs(atStop?.[1] ?? 1)).toBeLessThan(0.15);
      expect(atStop?.[2]).toBe(0);
    });

    it('reads the graph clock on every tick, whether it draws or not', async () => {
      const { encoder, stop, context } = setup({ drawEvery: false });
      const reads = vi.spyOn(context, 'currentTime', 'get');
      encoder.start(new MediaStream(), { audioBitsPerSecond: 64_000, timesliceMs: 1000 });
      await vi.advanceTimersByTimeAsync(1000);
      // Ten ticks, one of them drawn: the more readings, the tighter the clock's bounds.
      expect(reads.mock.calls.length).toBeGreaterThanOrEqual(10);
      await stop();
    });

    it('writes the audio clock line once a minute, however long a pause', async () => {
      const { encoder, stop, logs, run } = setup();
      encoder.start(new MediaStream(), { audioBitsPerSecond: 64_000, timesliceMs: 1000 });
      await run(30_000);
      encoder.pause();
      await vi.advanceTimersByTimeAsync(150_000);
      encoder.resume();
      await run(31_000);
      await stop();
      expect(logs.filter((line) => line.startsWith('audio clock'))).toHaveLength(2);
    });

    it('puts the time before the audio graph ran at the start of the file', async () => {
      const audio = recordTimeline();
      try {
        const { encoder, stop, logs, context } = setup({ worklet: true });
        encoder.start(new MediaStream(), { audioBitsPerSecond: 64_000, timesliceMs: 1000 });
        // A new context: its graph starts running 1.4 s after the recording.
        await vi.advanceTimersByTimeAsync(1400);
        await render(context, 4, 0.5);
        await stop();
        const runs = audio.runs();
        expect(runs.map(([value]) => value)).toEqual([0, 0.5]);
        expect(runs[0]?.[1]).toBeGreaterThan(1.3);
        expect(runs[0]?.[1]).toBeLessThanOrEqual(1.45);
        expect(runs[1]?.[1]).toBeCloseTo(4, 1);
        expect(logs.filter((line) => line.startsWith('audio starts'))).toHaveLength(1);
        expect(logs.filter((line) => line.includes('filled with silence'))).toEqual([]);
      } finally {
        audio.restore();
      }
    });

    it('fills a stop of the audio graph with silence where the graph stopped', async () => {
      const audio = recordTimeline();
      try {
        const { encoder, stop, chunks, logs, context } = setup({ worklet: true });
        encoder.start(new MediaStream(), { audioBitsPerSecond: 64_000, timesliceMs: 1000 });
        await vi.advanceTimersByTimeAsync(0);
        await render(context, 2, 0.25);
        // The browser suspends the context for 3 s, with no event: wall time runs, the graph not.
        await vi.advanceTimersByTimeAsync(3000);
        await render(context, 2, 0.5);
        await stop();
        const runs = audio.runs();
        expect(runs.map(([value]) => value)).toEqual([0.25, 0, 0.5]);
        expect(runs[0]?.[1]).toBeCloseTo(2, 1);
        expect(runs[1]?.[1]).toBeGreaterThan(2.9);
        expect(runs[1]?.[1]).toBeLessThan(3.1);
        expect(runs[2]?.[1]).toBeCloseTo(2, 1);
        expect(logs.filter((line) => line.includes('filled with silence'))).toHaveLength(1);
        expect((await parse(chunks)).audioDuration).toBeCloseTo(7, 0);
        // The silence went to the muxer a second at a time.
        expect(audio.largest()).toBe(48_000);
      } finally {
        audio.restore();
      }
    });
  });

  it('stop before start resolves immediately', async () => {
    const { encoder } = setup();
    await expect(encoder.stop()).resolves.toBeUndefined();
  });

  it('reports a muxer failure at stop time and still closes the batcher', async () => {
    const { encoder, stop, errors, run } = setup({ writeFails: true });
    encoder.start(new MediaStream(), { audioBitsPerSecond: 64_000, timesliceMs: 1000 });
    await run(500);
    await stop();
    expect(errors.length).toBeGreaterThanOrEqual(1);
    expect(errors[0]?.message).toContain('disk');
  });

  it('refuses to start twice', () => {
    const { encoder } = setup();
    encoder.start(new MediaStream(), { audioBitsPerSecond: 64_000, timesliceMs: 1000 });
    expect(() =>
      encoder.start(new MediaStream(), { audioBitsPerSecond: 64_000, timesliceMs: 1000 }),
    ).toThrow('already started');
  });

  it('keeps the timeline continuous across pause/resume and drops media while paused', async () => {
    const { encoder, stop, chunks, run } = setup();
    encoder.start(new MediaStream(), { audioBitsPerSecond: 64_000, timesliceMs: 1000 });
    await run(1000);
    encoder.pause();
    expect(encoder.state()).toBe('paused');
    // The next ScriptProcessor buffer holds the moment of the pause: kept, and nothing after it.
    await run(100);
    const videoBefore = fakes.videoPackets;
    const audioBefore = fakes.audioPackets;
    await run(2000);
    expect(fakes.videoPackets).toBe(videoBefore);
    expect(fakes.audioPackets).toBe(audioBefore);
    encoder.resume();
    expect(encoder.state()).toBe('recording');
    await run(1000);
    await stop();
    const file = await parse(chunks);
    expect(file.duration).toBeGreaterThanOrEqual(1.9);
    expect(file.duration).toBeLessThanOrEqual(2.2);
  });

  it('keeps the audio still queued for the main thread when stopped', async () => {
    const { encoder, chunks, errors, context } = setup({ worklet: true });
    encoder.start(new MediaStream(), { audioBitsPerSecond: 64_000, timesliceMs: 1000 });
    await vi.advanceTimersByTimeAsync(0); // the worklet module loads
    await render(context, 2, 0.25);
    // The page gets busy: 2 s of buffers wait in the port's queue when Stop comes.
    const node = context.workletNodes[0];
    if (!node) throw new Error('no worklet node');
    node.holdMessages = true;
    await render(context, 2, 0.5);
    const stopped = encoder.stop();
    await vi.advanceTimersByTimeAsync(0);
    node.holdMessages = false;
    node.deliver();
    await stopped;
    expect(errors).toEqual([]);
    const file = await parse(chunks);
    expect(file.audioDuration).toBeGreaterThanOrEqual(3.95);
    expect(file.audioDuration).toBeLessThanOrEqual(4.1);
  });

  it('keeps what was captured before a pause, and nothing captured during it', async () => {
    const audio = recordAudio();
    try {
      const { encoder, stop, logs, context } = setup({ worklet: true });
      encoder.start(new MediaStream(), { audioBitsPerSecond: 64_000, timesliceMs: 1000 });
      await vi.advanceTimersByTimeAsync(0);
      await render(context, 2, 0.25);
      const node = context.workletNodes[0];
      if (!node) throw new Error('no worklet node');
      // Busy when Pause comes: the last second before it and the start of the pause are queued.
      // (A busy page runs no timers either: the drain's one-second wait cannot end meanwhile.)
      node.holdMessages = true;
      await render(context, 1, 0.25);
      encoder.pause();
      await render(context, 0.5, 0.75);
      node.holdMessages = false;
      node.deliver();
      await render(context, 1.5, 0.75);
      encoder.resume();
      await render(context, 3, 0.5);
      await stop();
      expect(audio.seconds(0.25)).toBeCloseTo(3, 1);
      expect(audio.seconds(0.75)).toBe(0);
      expect(audio.seconds(0.5)).toBeCloseTo(3, 1);
      expect(logs.filter((line) => line.includes('silence'))).toEqual([]);
    } finally {
      audio.restore();
    }
  });

  it('drops what was captured during a pause even when it arrives after Resume', async () => {
    const audio = recordAudio();
    try {
      const { encoder, stop, context } = setup({ worklet: true });
      encoder.start(new MediaStream(), { audioBitsPerSecond: 64_000, timesliceMs: 1000 });
      await vi.advanceTimersByTimeAsync(0);
      await render(context, 1, 0.25);
      encoder.pause();
      await vi.advanceTimersByTimeAsync(0);
      const node = context.workletNodes[0];
      if (!node) throw new Error('no worklet node');
      // Busy through the pause: its audio is still queued when Resume comes.
      node.holdMessages = true;
      await render(context, 2, 0.75);
      encoder.resume();
      await render(context, 0.5, 0.5);
      node.holdMessages = false;
      node.deliver();
      await render(context, 1.5, 0.5);
      await stop();
      expect(audio.seconds(0.25)).toBeCloseTo(1, 1);
      expect(audio.seconds(0.75)).toBe(0);
      expect(audio.seconds(0.5)).toBeCloseTo(2, 1);
    } finally {
      audio.restore();
    }
  });

  it('stops after a pause whose queued audio has not arrived yet, keeping that audio', async () => {
    const audio = recordAudio();
    try {
      const { encoder, chunks, context } = setup({ worklet: true });
      encoder.start(new MediaStream(), { audioBitsPerSecond: 64_000, timesliceMs: 1000 });
      await vi.advanceTimersByTimeAsync(0);
      const node = context.workletNodes[0];
      if (!node) throw new Error('no worklet node');
      node.holdMessages = true;
      await render(context, 2, 0.25);
      encoder.pause();
      await render(context, 0.5, 0.75);
      const stopped = encoder.stop();
      await vi.advanceTimersByTimeAsync(0);
      node.holdMessages = false;
      node.deliver();
      await stopped;
      expect(audio.seconds(0.25)).toBeCloseTo(2, 1);
      expect(audio.seconds(0.75)).toBe(0);
      expect((await parse(chunks)).audioDuration).toBeCloseTo(2, 1);
    } finally {
      audio.restore();
    }
  });

  it('only draws on heartbeat when nothing changes, and stamps video from wall time without audio', async () => {
    const { encoder, stop, chunks, compositor, context } = setup({ drawEvery: false });
    encoder.start(new MediaStream(), { audioBitsPerSecond: 64_000, timesliceMs: 1000 });
    await vi.advanceTimersByTimeAsync(4100);
    expect(compositor.framesDrawn()).toBe(3);
    expect(context.processors.length).toBe(1);
    await stop();
    const file = await parse(chunks);
    expect(file.tracks).toEqual(['video:vp9']);
    expect(file.video?.packets).toBe(3);
  });

  it('records what every tick cost: frames encoded, unchanged ticks and the time of each step', async () => {
    const { encoder, stop, stats, run } = setup();
    encoder.start(new MediaStream(), { audioBitsPerSecond: 64_000, timesliceMs: 1000 });
    await run(1000);
    await stop();
    const snapshot = stats.snapshot();
    expect(snapshot.ticks).toBe(10);
    expect(snapshot.encoded).toBe(10);
    expect(snapshot.unchanged).toBe(0);
    for (const step of ['find', 'layout', 'draw', 'frame', 'encode', 'wait'] as const) {
      expect(snapshot.sums[step]).toBeGreaterThanOrEqual(0);
    }
    const quiet = setup({ drawEvery: false });
    quiet.encoder.start(new MediaStream(), { audioBitsPerSecond: 64_000, timesliceMs: 1000 });
    await vi.advanceTimersByTimeAsync(1000);
    await quiet.stop();
    expect(quiet.stats.snapshot()).toMatchObject({ ticks: 10, encoded: 1, unchanged: 9 });
  });

  it('counts the wait for snapshots as waiting, not as main-thread work', async () => {
    const { encoder, stop, stats, run } = setup({ snapshotWaitMs: 7 });
    encoder.start(new MediaStream(), { audioBitsPerSecond: 64_000, timesliceMs: 1000 });
    await run(1000);
    await stop();
    const { encoded, sums } = stats.snapshot();
    expect(sums.wait).toBeGreaterThanOrEqual(7 * encoded);
  });

  it('flush emits the buffered bytes immediately', async () => {
    const { encoder, stop, chunks, run } = setup();
    encoder.start(new MediaStream(), { audioBitsPerSecond: 64_000, timesliceMs: 60_000 });
    await run(1500);
    expect(chunks).toEqual([]);
    encoder.flush();
    expect(chunks.length).toBe(1);
    await stop();
  });

  it('reports an encoder failure once and still stops cleanly', async () => {
    const { encoder, stop, errors, run } = setup();
    encoder.start(new MediaStream(), { audioBitsPerSecond: 64_000, timesliceMs: 1000 });
    await run(500);
    fakes.failNextVideoEncode = new Error('gpu reset');
    await run(1000);
    await stop();
    expect(errors.map((e) => e.message)).toEqual(['gpu reset']);
  });

  it('wraps non-Error failures', async () => {
    const { encoder, stop, errors, run } = setup();
    encoder.start(new MediaStream(), { audioBitsPerSecond: 64_000, timesliceMs: 1000 });
    await run(200);
    fakes.failNextVideoEncode = 'boom' as unknown as Error;
    await run(500);
    await stop();
    expect(errors.map((e) => e.message)).toEqual(['boom']);
  });
});

describe('createWebCodecsEncoder video timestamps', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  /** The timestamps (s) of the video packets of the file the chunks make, in file order. */
  const videoTimestamps = (chunks: EncodedChunk[]) =>
    readVideoTimestamps(
      new Blob(
        chunks.map((c) => c.blob),
        { type: 'video/webm' },
      ),
    );
  /** The timestamps that do not come after the one before them: none, when every frame has its own. */
  const repeated = (stamps: number[]) =>
    stamps.filter((t, i) => i > 0 && t <= (stamps[i - 1] ?? t));

  it('gives a fast frame after a slow one a timestamp of its own, though both fall into one slot', async () => {
    // At 10 fps the clock ticks every 100 ms. The first frame takes 60 ms to draw (0.16 s), the
    // next one is drawn on time (0.2 s): the muxer rounds both to the 0.2 s slot of the grid.
    const { encoder, stop, chunks, errors } = setup({ drawMs: [60, 0, 60, 0, 60, 0] });
    encoder.start(new MediaStream(), { audioBitsPerSecond: 64_000, timesliceMs: 1000 });
    await vi.advanceTimersByTimeAsync(1050);
    await stop();
    const stamps = await videoTimestamps(chunks);
    expect(errors).toEqual([]);
    expect(stamps).toHaveLength(fakes.videoPackets);
    expect(stamps.length).toBeGreaterThanOrEqual(9);
    expect(repeated(stamps)).toEqual([]);
  });

  it('gives the first frame after a pause a timestamp of its own, though the clock stood still', async () => {
    // The frame drawn last before Pause is stamped late in its slot (0.96 s, slot 1.0 s); the
    // clock stands still while paused, so the first frame after Resume lands in that slot too.
    const { encoder, stop, chunks, errors } = setup({ drawMs: [0, 0, 0, 0, 0, 0, 0, 0, 60] });
    encoder.start(new MediaStream(), { audioBitsPerSecond: 64_000, timesliceMs: 1000 });
    await vi.advanceTimersByTimeAsync(970);
    encoder.pause();
    await vi.advanceTimersByTimeAsync(2000);
    encoder.resume();
    await vi.advanceTimersByTimeAsync(200);
    await stop();
    const stamps = await videoTimestamps(chunks);
    expect(errors).toEqual([]);
    expect(stamps).toHaveLength(fakes.videoPackets);
    expect(repeated(stamps)).toEqual([]);
  });

  it('draws nothing on a tick the grid has no slot for, when the clock ticks faster than it', async () => {
    // The clock ticks at 10 fps, the track's grid has a slot every 200 ms: every other tick of
    // the clock comes when the file already holds a frame for a later slot.
    const { encoder, stop, chunks, errors, stats } = setup({ plan: { ...plan, fps: 5 } });
    encoder.start(new MediaStream(), { audioBitsPerSecond: 64_000, timesliceMs: 1000 });
    await vi.advanceTimersByTimeAsync(2050);
    await stop();
    const stamps = await videoTimestamps(chunks);
    const { ticks, encoded } = stats.snapshot();
    expect(errors).toEqual([]);
    // The grid has a slot every 200 ms: 11 of the 20 ticks of 2 s draw, each into a slot of its own.
    expect(ticks).toBe(20);
    expect(encoded).toBe(11);
    expect(stamps).toHaveLength(11);
    expect(repeated(stamps)).toEqual([]);
    expect(stamps.map((t) => Math.round(t * 5) / 5)).toEqual(stamps);
  });
});

describe('createWebCodecsEncoder colour tag', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  // Firefox converts the canvas with BT.601 at limited range and reports BT.709 (a constant, the
  // fake encoder's too): the file must name the conversion, not the report.
  it.each(['vp9', 'vp8'] as const)(
    'tags %s video BT.601 at limited range, as Firefox converts the canvas',
    async (codec) => {
      const { encoder, stop, chunks, errors, run } = setup({ plan: { ...plan, codec } });
      encoder.start(new MediaStream(), { audioBitsPerSecond: 64_000, timesliceMs: 1000 });
      await run(1500);
      await stop();
      expect(errors).toEqual([]);
      const file = await parse(chunks);
      // The pixels come from an sRGB canvas: BT.709 primaries, a BT.709-like transfer.
      expect(file.video?.colorSpace).toEqual({
        primaries: 'bt709',
        transfer: 'bt709',
        matrix: 'smpte170m',
        fullRange: false,
      });
    },
  );
});
