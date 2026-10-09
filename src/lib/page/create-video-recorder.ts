/**
 * Composes the video pipeline for one recording from browser primitives: tile compositor, frame
 * clock, audio tap, byte batcher and the WebCodecs/Mediabunny encoder. The page session only sees
 * the `Encoder` plus a few knobs for the overlay and adaptive downgrades.
 */
import { type AudioTap, type AudioTapDeps, createAudioTap } from '@/lib/page/create-audio-tap';
import { createByteBatcher } from '@/lib/page/create-byte-batcher';
import type { EncodedChunk, Encoder } from '@/lib/page/create-media-recorder-encoder';
import { createWebCodecsEncoder } from '@/lib/page/create-webcodecs-encoder';
import type { VideoTile } from '@/lib/types';
import { computeFrameSignature } from '@/lib/video/compute-frame-signature';
import { createFrameClock, type FrameClock } from '@/lib/video/create-frame-clock';
import { createFrameSignals } from '@/lib/video/create-frame-signals';
import {
  createFrameStats,
  type FrameStatsSnapshot,
  type RecentLoad,
} from '@/lib/video/create-frame-stats';
import { createTileCompositor, type SourceSnapshot } from '@/lib/video/create-tile-compositor';
import { drawCompositeFrame } from '@/lib/video/draw-composite-frame';
import { layoutTiles } from '@/lib/video/layout-tiles';
import type { VideoPlan } from '@/lib/video/pick-video-plan';

export interface VideoRecorderDeps {
  win: Window & typeof globalThis;
  plan: VideoPlan;
  /** The mixer's context: the audio tap reads the mixed stream through it. */
  context: AudioContext;
  /** The provider's tile lookup, run on every frame. */
  findTiles: () => VideoTile[];
  onChunk: (chunk: EncodedChunk) => void;
  onError: (error: Error) => void;
  onLog?: (message: string) => void;
  /** Where else the audio tap may load its worklet's module, and through what (`createAudioTap`). */
  tapModule?: Pick<AudioTapDeps, 'moduleFile' | 'addModule'>;
}

export interface VideoRecorder {
  encoder: Encoder;
  tileCount(): number;
  /** What the pipeline has cost so far (counters, sums, percentiles). */
  stats(): FrameStatsSnapshot;
  /** The pipeline's load over the last `windowMs`. */
  recentLoad(windowMs: number): RecentLoad;
  fps(): number;
  setFps(fps: number): void;
  dispose(): void;
}

/**
 * A frame is encoded at least this often even when nothing changed: Mediabunny's muxer holds the
 * audio until the next video frame, so this bounds what a crash can lose (plus one chunk), and it
 * redraws every tile in case a frame signal was missed.
 */
const HEARTBEAT_MS = 1_000;
const MAX_CHUNK_BYTES = 1024 * 1024;

/** One snapshot of a canvas source for a frame; null when it cannot be taken. */
async function snapshotCanvas(
  win: Window & typeof globalThis,
  source: HTMLCanvasElement,
): Promise<SourceSnapshot | null> {
  try {
    const bitmap = await win.createImageBitmap(source);
    return { image: bitmap, close: () => bitmap.close() };
  } catch {
    // A canvas without pixels yet (0x0) cannot be snapshotted; draw it directly.
    return null;
  }
}

/** The audio tap on the mixer's context, with the page's worklet and its module sources. */
function createPageAudioTap(
  deps: VideoRecorderDeps,
  stream: MediaStream,
  onSamples: AudioTapDeps['onSamples'],
): AudioTap {
  const { win } = deps;
  return createAudioTap({
    context: deps.context,
    stream,
    onSamples,
    // Undefined at runtime where worklets are unavailable; the tap then uses its fallback.
    AudioWorkletNode: win.AudioWorkletNode,
    createObjectURL: (blob) => win.URL.createObjectURL(blob),
    revokeObjectURL: (url) => win.URL.revokeObjectURL(url),
    ...deps.tapModule,
    setTimeout: (handler, ms) => win.setTimeout(handler, ms),
    clearTimeout: (id) => win.clearTimeout(id),
  });
}

export function createVideoRecorder(deps: VideoRecorderDeps): VideoRecorder {
  const { win, plan } = deps;
  const now = () => win.performance.now();
  const signals = createFrameSignals({
    requestAnimationFrame: (callback) => win.requestAnimationFrame(callback),
    now,
  });
  const compositor = createTileCompositor({
    createCanvas: () => win.document.createElement('canvas'),
    size: { width: plan.width, height: plan.height },
    viewport: () => ({ width: win.innerWidth, height: win.innerHeight }),
    labels: plan.labels,
    findTiles: deps.findTiles,
    layout: layoutTiles,
    signature: computeFrameSignature,
    draw: drawCompositeFrame,
    snapshot: (source) => snapshotCanvas(win, source),
    frameKeys: () => signals.keys(),
    now,
    ...(deps.onLog ? { onLog: deps.onLog } : {}),
  });
  const stats = createFrameStats();
  let clock: FrameClock | null = null;
  const encoder = createWebCodecsEncoder({
    plan,
    compositor,
    stats,
    createClock: (onTick) => {
      clock = createFrameClock({
        fps: plan.fps,
        heartbeatMs: HEARTBEAT_MS,
        setInterval: (handler, ms) => win.setInterval(handler, ms),
        clearInterval: (id) => win.clearInterval(id),
        now,
        onTick,
        onError: deps.onError,
        onBusy: (at) => stats.busy(at),
      });
      return clock;
    },
    createAudioTap: (stream, onSamples) => createPageAudioTap(deps, stream, onSamples),
    createBatcher: ({ maxMs, mimeType }, onChunk) =>
      createByteBatcher({
        maxBytes: MAX_CHUNK_BYTES,
        maxMs,
        mimeType,
        setTimeout: (handler, ms) => win.setTimeout(handler, ms),
        clearTimeout: (id) => win.clearTimeout(id),
        now,
        onChunk,
      }),
    now,
    onChunk: deps.onChunk,
    onError: deps.onError,
    ...(deps.onLog ? { onLog: deps.onLog } : {}),
  });
  return {
    encoder,
    tileCount: () => compositor.tileCount(),
    stats: () => stats.snapshot(),
    recentLoad: (windowMs) => stats.recent(now(), windowMs),
    fps: () => clock?.fps() ?? plan.fps,
    setFps: (fps) => clock?.setFps(fps),
    dispose: () => compositor.dispose(),
  };
}
