import { describe, expect, it } from 'vitest';
import type { VideoTile } from '@/lib/types';
import { markDominantShare } from './mark-dominant-share';

function tile(id: string, width: number, height: number, isSelf = false): VideoTile {
  return {
    id,
    source: document.createElement('video'),
    rect: { x: 0, y: 0, width, height },
    name: null,
    isSelf,
    isShare: false,
    sourceWidth: 640,
    sourceHeight: 360,
    frameKey: 0,
  };
}

const shares = (tiles: VideoTile[]) => tiles.filter((t) => t.isShare).map((t) => t.id);

describe('markDominantShare', () => {
  it('marks the tile at least twice as large as the next one', () => {
    const marked = markDominantShare([tile('a', 320, 180), tile('share', 1280, 720)]);
    expect(shares(marked)).toEqual(['share']);
  });

  it('marks nothing when tiles are of similar size', () => {
    expect(shares(markDominantShare([tile('a', 320, 180), tile('b', 400, 180)]))).toEqual([]);
  });

  it('never marks the self view (its area does not count), a single tile or empty rects', () => {
    const selfAndCameras = [tile('me', 1280, 720, true), tile('a', 320, 180), tile('b', 320, 180)];
    expect(shares(markDominantShare(selfAndCameras))).toEqual([]);
    expect(
      shares(markDominantShare([tile('me', 1280, 720, true), tile('me2', 1, 1, true)])),
    ).toEqual([]);
    expect(shares(markDominantShare([tile('only', 1280, 720)]))).toEqual([]);
    expect(shares(markDominantShare([tile('a', 0, 0), tile('b', 0, 0)]))).toEqual([]);
    expect(markDominantShare([])).toEqual([]);
  });

  it('returns new tiles and leaves the input untouched', () => {
    const input = [tile('a', 320, 180), tile('share', 1280, 720)];
    const marked = markDominantShare(input);
    expect(input.every((t) => !t.isShare)).toBe(true);
    expect(marked[1]).not.toBe(input[1]);
  });

  it('clears a stale share flag', () => {
    const stale = { ...tile('a', 320, 180), isShare: true };
    expect(shares(markDominantShare([stale, tile('b', 320, 180)]))).toEqual([]);
  });
});
