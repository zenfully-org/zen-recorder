import { describe, expect, it } from 'vitest';
import { anchorOverlayPosition } from './anchor-overlay-position';

const viewport = { width: 1280, height: 800 };

describe('anchorOverlayPosition', () => {
  it.each([
    [
      'the top left quarter',
      { x: 20, y: 30, width: 100, height: 32 },
      { horizontal: 'left', x: 20, vertical: 'top', y: 30 },
    ],
    [
      'the top right quarter',
      { x: 1160, y: 384, width: 100, height: 32 },
      { horizontal: 'right', x: 20, vertical: 'top', y: 384 },
    ],
    [
      'the bottom left quarter',
      { x: 8, y: 700, width: 100, height: 32 },
      { horizontal: 'left', x: 8, vertical: 'bottom', y: 68 },
    ],
    [
      'the bottom right quarter',
      { x: 1000, y: 600, width: 260, height: 180 },
      { horizontal: 'right', x: 20, vertical: 'bottom', y: 20 },
    ],
  ] as const)('docks a card in %s to its nearest edges', (_label, rect, position) => {
    expect(anchorOverlayPosition(rect, viewport)).toEqual(position);
  });

  it('docks a card centred on an axis to the left and top edges', () => {
    expect(anchorOverlayPosition({ x: 590, y: 384, width: 100, height: 32 }, viewport)).toEqual({
      horizontal: 'left',
      x: 590,
      vertical: 'top',
      y: 384,
    });
  });

  it('rounds to whole pixels and never goes past an edge', () => {
    expect(anchorOverlayPosition({ x: 1190.4, y: -3.2, width: 100, height: 32 }, viewport)).toEqual(
      { horizontal: 'right', x: 0, vertical: 'top', y: 0 },
    );
  });
});
