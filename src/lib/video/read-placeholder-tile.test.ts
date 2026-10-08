import { describe, expect, it } from 'vitest';
import { readPlaceholderTile } from './read-placeholder-tile';

describe('readPlaceholderTile', () => {
  it('builds a tile without a source from the element that stands in for the participant', () => {
    const avatar = document.createElement('div');
    Object.defineProperty(avatar, 'getBoundingClientRect', {
      value: () => ({ left: 40, top: 30, width: 320, height: 180 }),
    });
    expect(readPlaceholderTile({ id: 'p7', element: avatar, name: 'Ana', isSelf: false })).toEqual({
      id: 'p7',
      source: null,
      rect: { x: 40, y: 30, width: 320, height: 180 },
      name: 'Ana',
      isSelf: false,
      isShare: false,
      sourceWidth: 0,
      sourceHeight: 0,
      frameKey: 0,
    });
  });
});
