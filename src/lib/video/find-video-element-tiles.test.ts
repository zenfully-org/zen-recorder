import { beforeEach, describe, expect, it } from 'vitest';
import { createFakeVideoTile } from '@/test/fakes/create-fake-video-tile';
import { findVideoElementTiles } from './find-video-element-tiles';

beforeEach(() => document.body.replaceChildren());

describe('findVideoElementTiles', () => {
  it('returns every playing <video> that has a frame, in document order', () => {
    const a = createFakeVideoTile(document, { rect: { x: 0, y: 0, width: 320, height: 180 } });
    const b = createFakeVideoTile(document, { rect: { x: 320, y: 0, width: 320, height: 180 } });
    document.body.append(a.container, b.container);
    const tiles = findVideoElementTiles(document);
    expect(tiles.map((t) => t.id)).toEqual(['video-0', 'video-1']);
    expect(tiles[0]).toMatchObject({
      source: a.video,
      rect: { x: 0, y: 0, width: 320, height: 180 },
      name: null,
      isSelf: false,
      isShare: false,
      sourceWidth: 640,
      sourceHeight: 360,
    });
  });

  it('skips videos without a frame, not ready or paused', () => {
    const noFrame = createFakeVideoTile(document, { videoWidth: 0 });
    const notReady = createFakeVideoTile(document, { readyState: 1 });
    const paused = createFakeVideoTile(document, { paused: true });
    const ok = createFakeVideoTile(document);
    document.body.append(noFrame.container, notReady.container, paused.container, ok.container);
    expect(findVideoElementTiles(document).map((t) => t.id)).toEqual(['video-3']);
  });

  it('returns nothing for a page without videos', () => {
    expect(findVideoElementTiles(document)).toEqual([]);
  });
});
