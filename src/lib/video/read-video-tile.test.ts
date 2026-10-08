import { describe, expect, it } from 'vitest';
import { readVideoTile } from './read-video-tile';

function videoElement(media: { videoWidth: number; videoHeight: number; currentTime: number }) {
  const video = document.createElement('video');
  for (const key of ['videoWidth', 'videoHeight', 'currentTime'] as const) {
    Object.defineProperty(video, key, { get: () => media[key], configurable: true });
  }
  return video;
}

function place<T extends Element>(element: T, x: number, y: number, w: number, h: number): T {
  Object.defineProperty(element, 'getBoundingClientRect', {
    value: () => ({ left: x, top: y, width: w, height: h }),
    configurable: true,
  });
  return element;
}

describe('readVideoTile', () => {
  it('reads the rect, intrinsic size and current frame of a <video>', () => {
    const video = place(
      videoElement({ videoWidth: 1280, videoHeight: 720, currentTime: 4.5 }),
      10,
      20,
      320,
      180,
    );
    expect(readVideoTile({ id: 'p1', source: video, name: 'Ana', isSelf: true })).toEqual({
      id: 'p1',
      source: video,
      rect: { x: 10, y: 20, width: 320, height: 180 },
      name: 'Ana',
      isSelf: true,
      isShare: false,
      sourceWidth: 1280,
      sourceHeight: 720,
      frameKey: 4.5,
    });
  });

  it('reads the backing-store size of a <canvas>, whose frames cannot be told apart', () => {
    const canvas = place(document.createElement('canvas'), 0, 0, 640, 360);
    canvas.width = 1920;
    canvas.height = 1080;
    expect(readVideoTile({ id: 'gallery', source: canvas, name: null, isSelf: false })).toEqual({
      id: 'gallery',
      source: canvas,
      rect: { x: 0, y: 0, width: 640, height: 360 },
      name: null,
      isSelf: false,
      isShare: false,
      sourceWidth: 1920,
      sourceHeight: 1080,
      frameKey: 0,
    });
  });

  it('carries the region of a shared source that belongs to this tile', () => {
    const canvas = place(document.createElement('canvas'), 0, 0, 640, 360);
    canvas.width = 1280;
    canvas.height = 720;
    const crop = { x: 640, y: 0, width: 640, height: 720 };
    const base = { id: 'p2', source: canvas, name: 'Bea', isSelf: false };
    expect(readVideoTile({ ...base, crop })).toMatchObject({
      sourceWidth: 1280,
      sourceHeight: 720,
      crop,
    });
    expect('crop' in readVideoTile(base)).toBe(false);
  });

  it('lets the caller supply the frame key (a tick counter for canvases, say)', () => {
    const canvas = place(document.createElement('canvas'), 0, 0, 10, 10);
    const video = place(
      videoElement({ videoWidth: 2, videoHeight: 2, currentTime: 9 }),
      0,
      0,
      1,
      1,
    );
    const base = { id: 'x', name: null, isSelf: false };
    expect(readVideoTile({ ...base, source: canvas, frameKey: 42 }).frameKey).toBe(42);
    expect(readVideoTile({ ...base, source: video, frameKey: 7 }).frameKey).toBe(7);
  });
});
