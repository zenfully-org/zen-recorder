import { VideoSampleSource } from 'mediabunny';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { findMeetTiles } from '@/lib/providers/meet/find-meet-tiles';
import type { VideoTile } from '@/lib/types';
import type { VideoPlan } from '@/lib/video/pick-video-plan';
import { createFakeAudioContext } from '@/test/fakes/create-fake-audio-context';
import { createFakeCanvas } from '@/test/fakes/create-fake-canvas';
import { createFakeOffscreenCanvas } from '@/test/fakes/create-fake-offscreen-canvas';
import { createFakeVideoTile } from '@/test/fakes/create-fake-video-tile';
import { registerFakeMediabunnyEncoders } from '@/test/fakes/register-fake-mediabunny-encoders';
import type { EncodedChunk } from './create-media-recorder-encoder';
import { createVideoRecorder } from './create-video-recorder';

const plan: VideoPlan = {
  codec: 'vp8',
  width: 640,
  height: 360,
  fps: 10,
  bitsPerSecond: 500_000,
  labels: true,
};

interface BitmapLog {
  created: unknown[];
  closed: number;
  fail: boolean;
}

function setup(
  options: {
    withLog?: boolean;
    findTiles?: () => VideoTile[];
    bitmaps?: BitmapLog;
    frameCallbacks?: boolean;
  } = {},
) {
  vi.useFakeTimers();
  vi.stubGlobal('OffscreenCanvas', createFakeOffscreenCanvas());
  registerFakeMediabunnyEncoders();
  const fake = createFakeCanvas();
  const tile = createFakeVideoTile(document, {
    participantId: 'p1',
    name: 'Ana',
    frameCallbacks: options.frameCallbacks ?? false,
  });
  document.body.replaceChildren(tile.container);
  const chunks: EncodedChunk[] = [];
  const errors: Error[] = [];
  const logs: string[] = [];
  const context = createFakeAudioContext({ worklet: true });
  const win = {
    document: {
      createElement: () => fake.canvas,
      querySelectorAll: document.querySelectorAll.bind(document),
    },
    innerWidth: 1000,
    innerHeight: 600,
    performance: { now: () => Date.now() },
    setInterval: (handler: () => void, ms: number) => setInterval(handler, ms),
    clearInterval: (id: number) => clearInterval(id),
    setTimeout: (handler: () => void, ms: number) => setTimeout(handler, ms),
    // The page paints: animation frames answer right away.
    requestAnimationFrame: (callback: (at: number) => void) =>
      setTimeout(() => callback(Date.now()), 0),
    clearTimeout: (id: number) => clearTimeout(id),
    URL: {
      createObjectURL: (blob: Blob) => context.createObjectURL(blob),
      revokeObjectURL: () => undefined,
    },
    AudioWorkletNode: context.AudioWorkletNode,
    createImageBitmap: async (source: unknown) => {
      if (options.bitmaps?.fail) throw new Error('canvas has no pixels');
      options.bitmaps?.created.push(source);
      return {
        close: () => {
          if (options.bitmaps) options.bitmaps.closed++;
        },
      };
    },
  } as unknown as Window & typeof globalThis;
  const recorder = createVideoRecorder({
    win,
    plan,
    context: context as unknown as AudioContext,
    findTiles: options.findTiles ?? (() => findMeetTiles(document)),
    onChunk: (c) => chunks.push(c),
    onError: (e) => errors.push(e),
    ...(options.withLog === false ? {} : { onLog: (m: string) => logs.push(m) }),
  });
  return { recorder, fake, tile, chunks, errors, logs, context };
}

describe('createVideoRecorder', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('exposes the plan frame rate and zero stats before starting', () => {
    const { recorder, fake } = setup({ withLog: false });
    expect(recorder.fps()).toBe(10);
    expect(recorder.tileCount()).toBe(0);
    expect(recorder.stats()).toMatchObject({ ticks: 0, encoded: 0 });
    expect(recorder.recentLoad(5_000)).toMatchObject({ encodedPerS: 0, mainMsPerS: 0 });
    expect([fake.canvas.width, fake.canvas.height]).toEqual([640, 360]);
    recorder.setFps(5);
    expect(recorder.fps()).toBe(10);
    expect(recorder.encoder.mimeType()).toBe('video/webm;codecs=vp8,opus');
  });

  it('draws the page tiles into chunks once started, reports its cost and adapts its rate', async () => {
    const { recorder, fake, tile, chunks, errors, logs, context } = setup();
    recorder.encoder.start(new MediaStream(), { audioBitsPerSecond: 64_000, timesliceMs: 1000 });
    for (let i = 0; i < 25; i++) {
      tile.set({ currentTime: i / 10 });
      context.workletNodes[0]?.render(new Float32Array(4800));
      await vi.advanceTimersByTimeAsync(100);
    }
    expect(recorder.tileCount()).toBe(1);
    expect(recorder.stats().encoded).toBeGreaterThanOrEqual(20);
    expect(recorder.recentLoad(1_000).encodedPerS).toBeGreaterThanOrEqual(9);
    expect(fake.ctx.ops.some((op) => op.op === 'drawImage' && op.args[0] === tile.video)).toBe(
      true,
    );
    expect(fake.ctx.ops.some((op) => op.op === 'fillText' && op.args[0] === 'Ana')).toBe(true);
    recorder.setFps(5);
    expect(recorder.fps()).toBe(5);
    await recorder.encoder.stop();
    recorder.dispose();
    expect(errors).toEqual([]);
    expect(logs.filter((line) => line.startsWith('audio tap'))).toEqual(['audio tap: worklet']);
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    expect(fake.canvas.width).toBe(0);
  });

  it.each([
    ['takes one snapshot per frame of a canvas several tiles are cropped from', false],
    ['draws the canvas itself when it cannot be snapshotted', true],
  ])('%s', async (_name, fail) => {
    const shared = document.createElement('canvas');
    const crop = (id: string, x: number): VideoTile => ({
      id,
      source: shared,
      rect: { x, y: 0, width: 100, height: 100 },
      name: id,
      isSelf: false,
      isShare: false,
      sourceWidth: 400,
      sourceHeight: 200,
      crop: { x: x * 2, y: 0, width: 200, height: 200 },
      frameKey: Date.now(),
    });
    const bitmaps: BitmapLog = { created: [], closed: 0, fail };
    const { recorder, fake, context } = setup({
      withLog: false,
      bitmaps,
      findTiles: () => [crop('a', 0), crop('b', 100)],
    });
    recorder.encoder.start(new MediaStream(), { audioBitsPerSecond: 64_000, timesliceMs: 1000 });
    for (let i = 0; i < 5; i++) {
      context.workletNodes[0]?.render(new Float32Array(4800));
      await vi.advanceTimersByTimeAsync(100);
    }
    await recorder.encoder.stop();
    const draws = fake.ctx.ops.filter((op) => op.op === 'drawImage');
    expect(draws.length).toBeGreaterThanOrEqual(8);
    if (fail) {
      expect(bitmaps.created).toEqual([]);
      expect(draws.every((op) => op.args[0] === shared)).toBe(true);
    } else {
      expect(bitmaps.created.length).toBe(draws.length / 2);
      expect(bitmaps.created.every((source) => source === shared)).toBe(true);
      expect(bitmaps.closed).toBe(bitmaps.created.length);
      expect(draws.some((op) => op.args[0] === shared)).toBe(false);
    }
  });

  it('skips ticks while the painting page shows no new video frame, and encodes new ones', async () => {
    const { recorder, tile, context } = setup({ withLog: false, frameCallbacks: true });
    recorder.encoder.start(new MediaStream(), { audioBitsPerSecond: 64_000, timesliceMs: 1000 });
    for (let i = 0; i < 10; i++) {
      tile.set({ currentTime: i / 10 }); // moves without new frames, as on a MediaStream
      context.workletNodes[0]?.render(new Float32Array(4800));
      await vi.advanceTimersByTimeAsync(100);
    }
    const still = recorder.stats();
    expect(still.unchanged).toBeGreaterThanOrEqual(7);
    expect(still.encoded).toBeLessThanOrEqual(3);
    for (let i = 0; i < 10; i++) {
      tile.set({ currentTime: 1 + i / 10 });
      tile.newFrame();
      context.workletNodes[0]?.render(new Float32Array(4800));
      await vi.advanceTimersByTimeAsync(100);
    }
    expect(recorder.stats().encoded - still.encoded).toBeGreaterThanOrEqual(8);
    await recorder.encoder.stop();
  });

  it('still encodes a frame every second while nothing changes (the muxer holds audio until video comes)', async () => {
    const { recorder, context } = setup({ withLog: false, frameCallbacks: true });
    recorder.encoder.start(new MediaStream(), { audioBitsPerSecond: 64_000, timesliceMs: 1000 });
    for (let i = 0; i < 50; i++) {
      context.workletNodes[0]?.render(new Float32Array(4800));
      await vi.advanceTimersByTimeAsync(100);
    }
    // The first frame, one when the frame signal takes over, then one per second.
    expect(recorder.stats().encoded).toBeGreaterThanOrEqual(5);
    await recorder.encoder.stop();
  });

  it('counts the ticks a frame still in flight made the clock skip', async () => {
    const stuck = vi
      .spyOn(VideoSampleSource.prototype, 'add')
      .mockImplementation(() => new Promise<void>(() => undefined));
    try {
      const { recorder, context } = setup({ withLog: false });
      recorder.encoder.start(new MediaStream(), { audioBitsPerSecond: 64_000, timesliceMs: 1000 });
      context.workletNodes[0]?.render(new Float32Array(4800));
      await vi.advanceTimersByTimeAsync(1000);
      expect(recorder.stats()).toMatchObject({ ticks: 1, busyTicks: 9, encoded: 0 });
      expect(recorder.recentLoad(1_000).busyPerS).toBe(9);
    } finally {
      stuck.mockRestore();
    }
  });
});
