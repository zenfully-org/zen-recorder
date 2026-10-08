import { describe, expect, it } from 'vitest';
import type { OverlayPosition } from '@/lib/types';
import { clampOverlayPosition } from './clamp-overlay-position';

const card = { width: 260, height: 200 };

describe('clampOverlayPosition', () => {
  it('leaves a position that fits the window alone', () => {
    const position: OverlayPosition = { horizontal: 'right', x: 16, vertical: 'top', y: 300 };
    expect(clampOverlayPosition(position, card, { width: 1280, height: 800 })).toEqual(position);
  });

  it('brings a position kept from a larger window back inside a smaller one', () => {
    expect(
      clampOverlayPosition({ horizontal: 'left', x: 1500, vertical: 'bottom', y: 900 }, card, {
        width: 800,
        height: 600,
      }),
    ).toEqual({ horizontal: 'left', x: 532, vertical: 'bottom', y: 392 });
  });

  it('keeps a margin to the edge the card is docked to', () => {
    expect(
      clampOverlayPosition({ horizontal: 'right', x: 0, vertical: 'top', y: 2 }, card, {
        width: 1280,
        height: 800,
      }),
    ).toEqual({ horizontal: 'right', x: 8, vertical: 'top', y: 8 });
  });

  it('keeps the docked edge in view when the window is smaller than the card', () => {
    expect(
      clampOverlayPosition({ horizontal: 'right', x: 50, vertical: 'bottom', y: 50 }, card, {
        width: 200,
        height: 150,
      }),
    ).toEqual({ horizontal: 'right', x: 8, vertical: 'bottom', y: 8 });
  });
});
