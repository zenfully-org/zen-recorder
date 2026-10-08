import { describe, expect, it } from 'vitest';
import type { VideoTile } from '@/lib/types';
import { layoutTiles } from './layout-tiles';

const VIEWPORT = { width: 1000, height: 500 };
const CANVAS = { width: 1920, height: 1080 };

function tile(partial: Partial<VideoTile> & { id: string }): VideoTile {
  return {
    source: {} as HTMLVideoElement,
    rect: { x: 0, y: 0, width: 100, height: 100 },
    name: null,
    isSelf: false,
    isShare: false,
    sourceWidth: 640,
    sourceHeight: 360,
    frameKey: 0,
    ...partial,
  };
}

describe('layoutTiles', () => {
  it('returns nothing for no tiles', () => {
    expect(layoutTiles([], VIEWPORT, CANVAS)).toEqual([]);
  });

  it('scales a single full-viewport tile into the canvas without distortion', () => {
    const [cell] = layoutTiles(
      [tile({ id: 'a', rect: { x: 0, y: 0, width: 1000, height: 500 } })],
      VIEWPORT,
      CANVAS,
    );
    expect(cell).toMatchObject({ dx: 0, dy: 60, dw: 1920, dh: 960 });
    // 640x360 source shown in a 2:1 box: cover-crop the height.
    expect(cell).toMatchObject({ sx: 0, sy: 20, sw: 640, sh: 320 });
  });

  it('mirrors the on-screen geometry of several tiles and letterboxes the union box', () => {
    const cells = layoutTiles(
      [
        tile({ id: 'b', rect: { x: 500, y: 100, width: 400, height: 200 } }),
        tile({ id: 'a', rect: { x: 100, y: 100, width: 400, height: 200 } }),
      ],
      VIEWPORT,
      CANVAS,
    );
    // union = 800x200 → scale 2.4 → 1920x480 centred vertically (offset 300)
    expect(cells.map((c) => [c.tile.id, c.dx, c.dy, c.dw, c.dh])).toEqual([
      ['a', 0, 300, 960, 480],
      ['b', 960, 300, 960, 480],
    ]);
  });

  it('keeps a dominant screen-share tile dominant', () => {
    const cells = layoutTiles(
      [
        tile({ id: 'share', isShare: true, rect: { x: 0, y: 0, width: 800, height: 500 } }),
        tile({ id: 'cam', rect: { x: 800, y: 0, width: 200, height: 125 } }),
      ],
      VIEWPORT,
      CANVAS,
    );
    const share = cells.find((c) => c.tile.isShare);
    const cam = cells.find((c) => !c.tile.isShare);
    expect(share && cam && share.dw * share.dh > 10 * cam.dw * cam.dh).toBe(true);
  });

  it('drops tiles outside the viewport and clips partially visible ones', () => {
    const cells = layoutTiles(
      [
        tile({ id: 'off', rect: { x: 2000, y: 0, width: 100, height: 100 } }),
        tile({ id: 'edge', rect: { x: 900, y: 0, width: 200, height: 500 } }),
      ],
      VIEWPORT,
      CANVAS,
    );
    expect(cells.map((c) => c.tile.id)).toEqual(['edge']);
    // clipped to 100x500 → scale 2.16 → 216x1080 centred horizontally
    expect(cells[0]).toMatchObject({ dx: 852, dy: 0, dw: 216, dh: 1080 });
  });

  it('crops the source width when the video is wider than its box', () => {
    const [cell] = layoutTiles(
      [tile({ id: 'a', rect: { x: 0, y: 0, width: 500, height: 500 } })],
      VIEWPORT,
      CANVAS,
    );
    // square box: crop 640x360 to 360x360 centred
    expect(cell).toMatchObject({ sx: 140, sy: 0, sw: 360, sh: 360, dw: 1080, dh: 1080 });
  });

  it('takes a tile from its own region of a source shared by several tiles', () => {
    // A 1280x720 canvas showing two participants side by side; this tile is the right half.
    const [cell] = layoutTiles(
      [
        tile({
          id: 'a',
          rect: { x: 0, y: 0, width: 500, height: 500 },
          sourceWidth: 1280,
          sourceHeight: 720,
          crop: { x: 640, y: 0, width: 640, height: 720 },
        }),
      ],
      VIEWPORT,
      CANVAS,
    );
    // square box: the 640x720 region is cover-cropped to 640x640, centred vertically
    expect(cell).toMatchObject({ sx: 640, sy: 40, sw: 640, sh: 640, dw: 1080, dh: 1080 });
  });

  it('uses a zero source rect for an empty region', () => {
    const [cell] = layoutTiles(
      [tile({ id: 'a', crop: { x: 10, y: 10, width: 0, height: 0 } })],
      VIEWPORT,
      CANVAS,
    );
    expect(cell).toMatchObject({ sx: 0, sy: 0, sw: 0, sh: 0 });
  });

  it('uses a zero source rect for tiles without frames', () => {
    const [cell] = layoutTiles(
      [tile({ id: 'a', sourceWidth: 0, sourceHeight: 0 })],
      VIEWPORT,
      CANVAS,
    );
    expect(cell).toMatchObject({ sx: 0, sy: 0, sw: 0, sh: 0 });
  });

  it('falls back to a grid when no tile has a usable on-screen rect', () => {
    const zero = { x: 0, y: 0, width: 0, height: 0 };
    const cells = layoutTiles(
      [tile({ id: 'c', rect: zero }), tile({ id: 'a', rect: zero }), tile({ id: 'b', rect: zero })],
      VIEWPORT,
      CANVAS,
    );
    expect(cells.map((c) => [c.tile.id, c.dx, c.dy, c.dw, c.dh])).toEqual([
      ['a', 0, 0, 960, 540],
      ['b', 960, 0, 960, 540],
      ['c', 0, 540, 960, 540],
    ]);
  });
});
