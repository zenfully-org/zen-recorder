import { describe, expect, it } from 'vitest';
import type { VideoTile } from '@/lib/types';
import { computeFrameSignature } from './compute-frame-signature';

function tile(partial: Partial<VideoTile> = {}): VideoTile {
  return {
    id: 'p1',
    source: {} as HTMLVideoElement,
    rect: { x: 10.4, y: 20, width: 300, height: 200 },
    name: 'Ana',
    isSelf: false,
    isShare: false,
    sourceWidth: 640,
    sourceHeight: 360,
    frameKey: 1.5,
    ...partial,
  };
}

describe('computeFrameSignature', () => {
  it('is stable for identical input and empty for no tiles', () => {
    expect(computeFrameSignature([tile()])).toBe(computeFrameSignature([tile()]));
    expect(computeFrameSignature([])).toBe('');
  });

  it('ignores sub-pixel rect jitter', () => {
    expect(
      computeFrameSignature([tile({ rect: { x: 10.2, y: 20, width: 300, height: 200 } })]),
    ).toBe(computeFrameSignature([tile()]));
  });

  it.each([
    ['a new video frame', { frameKey: 1.6 }],
    ['a moved tile', { rect: { x: 50, y: 20, width: 300, height: 200 } }],
    ['a changed name', { name: 'Bea' }],
    ['a missing name', { name: null }],
    ['a resolution change', { sourceWidth: 1280, sourceHeight: 720 }],
    ['a different region of the source', { crop: { x: 0, y: 0, width: 320, height: 180 } }],
    ['a different participant', { id: 'p2' }],
  ])('changes with %s', (_label, change) => {
    expect(computeFrameSignature([tile(change)])).not.toBe(computeFrameSignature([tile()]));
  });
});
