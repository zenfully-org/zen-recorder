import { describe, expect, it } from 'vitest';
import type { VideoTile } from '@/lib/types';
import { createFrameSignals } from './create-frame-signals';

/** A `<video>` whose frame callbacks the test fires, like Firefox does once per new frame. */
function fakeVideo() {
  const video = document.createElement('video');
  let pending: (() => void)[] = [];
  Object.defineProperty(video, 'videoWidth', { value: 640 });
  Object.defineProperty(video, 'requestVideoFrameCallback', {
    value: (callback: () => void) => {
      pending.push(callback);
      return pending.length;
    },
  });
  return {
    video,
    armed: () => pending.length,
    newFrame() {
      const callbacks = pending;
      pending = [];
      for (const callback of callbacks) callback();
    },
  };
}

function tile(source: VideoTile['source'], frameKey = Math.random()): VideoTile {
  return {
    id: 't',
    source,
    rect: { x: 0, y: 0, width: 10, height: 10 },
    name: null,
    isSelf: false,
    isShare: false,
    sourceWidth: 640,
    sourceHeight: 360,
    frameKey,
  };
}

function setup() {
  let time = 0;
  let frames: ((at: number) => void)[] = [];
  const signals = createFrameSignals({
    requestAnimationFrame: (callback) => {
      frames.push(callback);
      return frames.length;
    },
    now: () => time,
  });
  return {
    signals,
    advance: (ms: number) => {
      time += ms;
    },
    /** The page paints: every pending animation frame runs now. */
    paint() {
      const callbacks = frames;
      frames = [];
      for (const callback of callbacks) callback(time);
    },
    pendingFrames: () => frames.length,
  };
}

describe('createFrameSignals', () => {
  it('keeps the provider key until it knows the page is painting', () => {
    const { signals } = setup();
    const { video } = fakeVideo();
    expect(signals.keys()(tile(video, 12.5))).toBe(12.5);
  });

  it('keys a still video tile by its frame count while the page paints, so it keeps its key', () => {
    const { signals, paint, advance } = setup();
    const camera = fakeVideo();
    signals.keys();
    paint();
    const first = signals.keys()(tile(camera.video));
    expect(camera.armed()).toBe(1);
    advance(66);
    paint();
    expect(signals.keys()(tile(camera.video))).toBe(first);
    // Armed once per frame, not once per call.
    expect(camera.armed()).toBe(1);
  });

  it('counts a tile as changing for a moment after each new frame, then keys it by its count again', () => {
    const { signals, paint, advance } = setup();
    const share = fakeVideo();
    signals.keys();
    paint();
    const still = signals.keys()(tile(share.video));
    share.newFrame(); // a slide changes
    advance(66);
    paint();
    // The frame callback runs after the picture changed: keep drawing while frames may still come.
    expect(signals.keys()(tile(share.video, 101))).toBe(101);
    advance(66);
    paint();
    expect(signals.keys()(tile(share.video, 102))).toBe(102);
    advance(100);
    paint();
    const after = signals.keys()(tile(share.video, 103));
    expect(after).not.toBe(still);
    advance(66);
    paint();
    expect(signals.keys()(tile(share.video, 104))).toBe(after);
  });

  it('treats a tile that keeps getting frames as changing on every tick (no frame is skipped)', () => {
    const { signals, paint, advance } = setup();
    const camera = fakeVideo();
    signals.keys();
    paint();
    signals.keys()(tile(camera.video));
    for (let i = 0; i < 10; i++) {
      camera.newFrame();
      advance(66);
      paint();
      expect(signals.keys()(tile(camera.video, i))).toBe(i);
    }
  });

  it('asks for one animation frame at a time', () => {
    const { signals, pendingFrames } = setup();
    signals.keys();
    signals.keys();
    expect(pendingFrames()).toBe(1);
  });

  it('falls back to the provider key once painting stops (hidden or minimized tab)', () => {
    const { signals, paint, advance } = setup();
    const camera = fakeVideo();
    signals.keys();
    paint();
    expect(signals.keys()(tile(camera.video, 1))).toBe(0);
    // No animation frame for a while: the page is not painting, frame callbacks are throttled.
    advance(300);
    expect(signals.keys()(tile(camera.video, 2))).toBe(2);
  });

  it('does not trust a slow animation frame (a throttled refresh driver)', () => {
    const { signals, paint, advance } = setup();
    const camera = fakeVideo();
    signals.keys();
    advance(900);
    paint();
    expect(signals.keys()(tile(camera.video, 3))).toBe(3);
  });

  it('keeps the provider key for canvases and placeholders, which have no frame signal', () => {
    const { signals, paint } = setup();
    signals.keys();
    paint();
    const keys = signals.keys();
    expect(keys(tile(document.createElement('canvas'), 7))).toBe(7);
    expect(keys(tile(null, 0))).toBe(0);
  });
});
