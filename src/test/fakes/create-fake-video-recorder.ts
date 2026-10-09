/** VideoRecorder double: an Encoder that records calls plus controllable stats and failure hooks. */
import type { EncodedChunk, Encoder } from '@/lib/page/create-media-recorder-encoder';
import type { VideoRecorder } from '@/lib/page/create-video-recorder';
import type { FrameStatsSnapshot, RecentLoad } from '@/lib/video/create-frame-stats';

export interface FakeVideoRecorder extends VideoRecorder {
  calls: string[];
  disposed: boolean;
  /** What `stats()` reports. */
  snapshot: FrameStatsSnapshot;
  /** What `recentLoad()` reports. */
  load: RecentLoad;
  /** The windows `recentLoad()` was asked for. */
  loadWindows: number[];
  /** Simulate an asynchronous encoder failure. */
  fail(error: Error): void;
  /** Hands the session a chunk of `bytes` bytes, one second of the recording after the last. */
  emitData(bytes: number): void;
  /**
   * Hands the session the last chunk once more, as the encoder does when Firefox stopped the page's
   * script while it was handing the chunk on (a closing tab's content process shutting down).
   */
  emitAgain(): void;
}

export function createFakeVideoRecorder(
  input: {
    onError: (error: Error) => void;
    onChunk?: ((chunk: EncodedChunk) => void) | undefined;
    fps: number;
    onLog?: ((message: string) => void) | undefined;
  },
  options: { throwOnStart?: boolean } = {},
): FakeVideoRecorder {
  let last: EncodedChunk | null = null;
  let state: RecordingState = 'inactive';
  let fps = input.fps;
  let seq = 0;
  const encoder: Encoder = {
    mimeType: () => 'video/webm;codecs=vp9,opus',
    state: () => state,
    start() {
      fake.calls.push('start');
      if (options.throwOnStart) throw new Error('no canvas');
      state = 'recording';
      input.onLog?.('audio tap: fake');
    },
    pause() {
      fake.calls.push('pause');
      state = 'paused';
    },
    resume() {
      fake.calls.push('resume');
      state = 'recording';
    },
    async stop() {
      fake.calls.push('stop');
      state = 'inactive';
    },
    flush() {
      fake.calls.push('flush');
    },
  };
  const fake: FakeVideoRecorder = {
    encoder,
    calls: [],
    disposed: false,
    snapshot: {
      ticks: 0,
      busyTicks: 0,
      unchanged: 0,
      encoded: 0,
      sums: { find: 0, layout: 0, draw: 0, frame: 0, encode: 0, wait: 0 },
      p95: { find: 0, layout: 0, draw: 0, frame: 0, encode: 0, wait: 0, total: 0 },
    },
    load: {
      encodedPerS: 0,
      ticksPerS: 0,
      busyPerS: 0,
      mainMsPerFrame: 0,
      mainMsPerS: 0,
      waitMsPerFrame: 0,
      p95MainMs: 0,
    },
    loadWindows: [],
    tileCount: () => 3,
    stats: () => fake.snapshot,
    recentLoad(windowMs) {
      fake.loadWindows.push(windowMs);
      return fake.load;
    },
    fps: () => fps,
    setFps(next) {
      fps = next;
      fake.calls.push(`setFps:${next}`);
    },
    dispose() {
      fake.disposed = true;
    },
    fail: (error) => input.onError(error),
    emitData(bytes) {
      const chunk = { seq, blob: new Blob([new Uint8Array(bytes)]), timestampMs: seq * 1000 };
      seq++;
      last = chunk;
      input.onChunk?.(chunk);
    },
    emitAgain() {
      if (last) input.onChunk?.(last);
    },
  };
  return fake;
}
