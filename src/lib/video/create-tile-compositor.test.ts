import { describe, expect, it } from 'vitest';
import type { VideoTile } from '@/lib/types';
import { createFakeCanvas } from '@/test/fakes/create-fake-canvas';
import { createTileCompositor, type TileCompositorDeps } from './create-tile-compositor';
import type { DrawOptions } from './draw-composite-frame';
import type { LayoutCell } from './layout-tiles';

/** A `<video>` as Firefox has it (happy-dom's has no `videoWidth`). */
function video(): HTMLVideoElement {
  const element = document.createElement('video');
  Object.defineProperty(element, 'videoWidth', { value: 640 });
  return element;
}

function tile(id: string, frameKey = 0): VideoTile {
  return {
    id,
    source: video(),
    rect: { x: 0, y: 0, width: 10, height: 10 },
    name: null,
    isSelf: false,
    isShare: false,
    sourceWidth: 640,
    sourceHeight: 360,
    frameKey,
  };
}

function setup(overrides: Partial<TileCompositorDeps> = {}) {
  const fake = createFakeCanvas();
  let tiles: VideoTile[] = [tile('a')];
  let time = 0;
  const drawCalls: { cells: LayoutCell[]; options: DrawOptions }[] = [];
  const compositor = createTileCompositor({
    createCanvas: () => fake.canvas,
    size: { width: 1920, height: 1080 },
    viewport: () => ({ width: 1000, height: 500 }),
    labels: true,
    findTiles: () => {
      time += 1;
      return tiles;
    },
    layout: (found) => {
      time += 2;
      return found.map((t) => ({
        tile: t,
        sx: 0,
        sy: 0,
        sw: 1,
        sh: 1,
        dx: 0,
        dy: 0,
        dw: 1,
        dh: 1,
      }));
    },
    signature: (found) => found.map((t) => `${t.id}:${t.frameKey}`).join(','),
    draw: (_ctx, cells, options) => {
      time += 5;
      drawCalls.push({ cells, options });
    },
    snapshot: async () => null,
    frameKeys: () => (t) => t.frameKey,
    now: () => time,
    ...overrides,
  });
  return { fake, compositor, drawCalls, setTiles: (next: VideoTile[]) => (tiles = next) };
}

describe('createTileCompositor', () => {
  it('creates a canvas of the configured size once', () => {
    const { fake, compositor } = setup();
    expect(compositor.canvas).toBe(fake.canvas);
    expect([fake.canvas.width, fake.canvas.height]).toEqual([1920, 1080]);
  });

  it('throws when the canvas has no 2D context', () => {
    const fake = createFakeCanvas();
    fake.contextUnavailable = true;
    expect(() => setup({ createCanvas: () => fake.canvas })).toThrow('2D canvas context');
  });

  it('draws when the signature changes and skips identical frames unless forced', async () => {
    const { compositor, drawCalls, setTiles } = setup();
    expect((await compositor.drawFrame()).drawn).toBe(true);
    expect((await compositor.drawFrame()).drawn).toBe(false);
    expect((await compositor.drawFrame({ force: true })).drawn).toBe(true);
    setTiles([tile('a', 1), tile('b')]);
    expect((await compositor.drawFrame()).drawn).toBe(true);
    expect(drawCalls.length).toBe(3);
    expect(drawCalls[2]?.cells.map((c) => c.tile.id)).toEqual(['a', 'b']);
    expect(drawCalls[2]?.options).toEqual({
      width: 1920,
      height: 1080,
      labels: true,
      images: new Map(),
    });
    expect(compositor.tileCount()).toBe(2);
    expect(compositor.framesDrawn()).toBe(3);
  });

  it('tells frames apart by the frame keys it is given for the tick, not by the tiles own keys', async () => {
    let tick = 0;
    const { compositor, drawCalls, setTiles } = setup({
      frameKeys: () => {
        tick++;
        return () => (tick < 3 ? 1 : 2);
      },
    });
    setTiles([tile('a', Math.random())]);
    expect((await compositor.drawFrame()).drawn).toBe(true);
    // The tile's own key changed (as a video's currentTime does), the frame key did not.
    setTiles([tile('a', Math.random())]);
    expect((await compositor.drawFrame()).drawn).toBe(false);
    setTiles([tile('a', Math.random())]);
    expect((await compositor.drawFrame()).drawn).toBe(true);
    expect(drawCalls).toHaveLength(2);
  });

  it('measures how long finding, laying out and drawing the tiles took', async () => {
    const { compositor } = setup();
    expect(await compositor.drawFrame()).toEqual({
      drawn: true,
      findMs: 1,
      layoutMs: 2,
      drawMs: 5,
      snapshotWaitMs: 0,
    });
    // An unchanged frame still had to look for the tiles.
    expect(await compositor.drawFrame()).toEqual({
      drawn: false,
      findMs: 1,
      layoutMs: 0,
      drawMs: 0,
      snapshotWaitMs: 0,
    });
  });

  it('takes one snapshot per canvas source and frame, draws every crop from it, then releases it', async () => {
    const shared = document.createElement('canvas');
    const image = document.createElement('canvas');
    const snapshots: HTMLCanvasElement[] = [];
    let closed = 0;
    const { compositor, drawCalls, setTiles } = setup({
      snapshot: async (source) => {
        snapshots.push(source);
        return { image, close: () => closed++ };
      },
    });
    const crop = (id: string): VideoTile => ({
      ...tile(id),
      source: shared,
      crop: { x: 0, y: 0, width: 5, height: 5 },
    });
    setTiles([crop('a'), crop('b'), tile('video')]);
    expect((await compositor.drawFrame()).drawn).toBe(true);
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]).toBe(shared);
    expect(drawCalls[0]?.options.images?.size).toBe(1);
    expect(drawCalls[0]?.options.images?.get(shared)).toBe(image);
    expect(closed).toBe(1);
  });

  it('counts only the synchronous part of taking a snapshot as drawing, the rest as waiting', async () => {
    const shared = document.createElement('canvas');
    let clock = 0;
    let finish: () => void = () => undefined;
    const { compositor, setTiles } = setup({
      now: () => clock,
      draw: () => {
        clock += 5;
      },
      snapshot: (source) => {
        clock += 3; // the call itself blocks the main thread briefly
        return new Promise((resolve) => {
          finish = () => {
            clock += 20; // the snapshot arrives later; the main thread was free meanwhile
            resolve({ image: source, close: () => undefined });
          };
        });
      },
    });
    setTiles([{ ...tile('a'), source: shared }]);
    const pending = compositor.drawFrame();
    finish();
    expect(await pending).toEqual({
      drawn: true,
      findMs: 0,
      layoutMs: 0,
      drawMs: 8,
      snapshotWaitMs: 20,
    });
  });

  it('draws a canvas source directly when no snapshot can be taken', async () => {
    const shared = document.createElement('canvas');
    const { compositor, drawCalls, setTiles } = setup({ snapshot: async () => null });
    setTiles([{ ...tile('a'), source: shared }]);
    await compositor.drawFrame();
    expect(drawCalls[0]?.options.images?.size).toBe(0);
  });

  it('does not draw a frame whose snapshot arrives after it was disposed, and releases it', async () => {
    const shared = document.createElement('canvas');
    let closed = 0;
    let resolve: () => void = () => undefined;
    const { compositor, drawCalls, setTiles } = setup({
      snapshot: (source) =>
        new Promise((done) => {
          resolve = () => done({ image: source, close: () => closed++ });
        }),
    });
    setTiles([{ ...tile('a'), source: shared }]);
    const pending = compositor.drawFrame();
    compositor.dispose();
    resolve();
    expect((await pending).drawn).toBe(false);
    expect(drawCalls).toEqual([]);
    expect(closed).toBe(1);
  });

  it('stops drawing and releases the canvas when disposed', async () => {
    const { fake, compositor } = setup();
    compositor.dispose();
    expect((await compositor.drawFrame({ force: true })).drawn).toBe(false);
    expect([fake.canvas.width, fake.canvas.height]).toEqual([0, 0]);
  });
});

describe('createTileCompositor, a canvas whose snapshots freeze the page', () => {
  it('draws the tiles of a canvas whose snapshot froze the page as placeholders, without snapshotting it, until it tries again', async () => {
    const shared = document.createElement('canvas');
    const camera = tile('camera');
    let clock = 0;
    const logs: string[] = [];
    const taken: number[] = [];
    const { compositor, drawCalls, setTiles } = setup({
      now: () => clock,
      onLog: (message) => logs.push(message),
      snapshot: (source) => {
        taken.push(clock);
        clock += 900; // a busy worker: the call blocks the main thread
        return Promise.resolve({ image: source, close: () => undefined });
      },
    });
    setTiles([{ ...tile('a'), source: shared }, camera]);
    await compositor.drawFrame({ force: true });
    expect(drawCalls[0]?.options.images?.get(shared)).toBe(shared);
    clock += 100;
    await compositor.drawFrame({ force: true });
    expect(taken).toEqual([0]);
    expect(drawCalls[1]?.cells.map((cell) => cell.tile.source)).toEqual([null, camera.source]);
    expect(drawCalls[1]?.options.images?.size).toBe(0);
    clock += 5_000;
    await compositor.drawFrame({ force: true });
    expect(taken).toEqual([0, 6_000]);
    expect(logs[0]).toBe(
      'a canvas snapshot blocked the page for 900 ms: its tiles are drawn as placeholders for 5 s',
    );
  });
});
