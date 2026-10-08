import { describe, expect, it, vi } from 'vitest';
import type { OverlayPosition, Size } from '@/lib/types';
import { createOverlayPlacement } from './create-overlay-placement';

function setup(position: OverlayPosition | null = null, size: Size = { width: 1280, height: 800 }) {
  const root = document.createElement('div');
  const card = document.createElement('div');
  root.append(card);
  let viewport = size;
  /** Lays the card out at this size, and puts it there on screen. */
  const placeCard = (x: number, y: number, width: number, height: number) => {
    Object.defineProperty(card, 'offsetWidth', { value: width, configurable: true });
    Object.defineProperty(card, 'offsetHeight', { value: height, configurable: true });
    return vi
      .spyOn(card, 'getBoundingClientRect')
      .mockReturnValue(new DOMRect(x, y, width, height));
  };
  placeCard(0, 0, 84, 34);
  const saved: OverlayPosition[] = [];
  const placement = createOverlayPlacement(
    { root, card },
    {
      position,
      viewport: () => viewport,
      onPositionChange: (next) => saved.push(next),
    },
  );
  const inset = () => [root.style.top, root.style.right, root.style.bottom, root.style.left];
  const resize = (next: Size) => {
    viewport = next;
  };
  return { root, placement, placeCard, saved, inset, resize };
}

describe('createOverlayPlacement', () => {
  it('puts a card never moved on the middle of the right edge', () => {
    const { root, placement, inset } = setup();
    placement.apply();
    expect(inset()).toEqual(['383px', '16px', 'auto', 'auto']);
    expect(root.dataset['horizontal']).toBe('right');
    expect(root.dataset['vertical']).toBe('top');
  });

  it('puts a card where the person left it on this service', () => {
    const { root, placement, inset } = setup({
      horizontal: 'left',
      x: 40,
      vertical: 'bottom',
      y: 120,
    });
    placement.apply();
    expect(inset()).toEqual(['auto', 'auto', '120px', '40px']);
    expect(root.dataset['horizontal']).toBe('left');
    expect(root.dataset['vertical']).toBe('bottom');
  });

  it('brings a remembered position back inside a smaller window, and gives it back in a larger one', () => {
    const { placement, inset, resize, saved } = setup(
      { horizontal: 'left', x: 1100, vertical: 'top', y: 700 },
      { width: 800, height: 600 },
    );
    placement.apply();
    expect(inset()).toEqual(['558px', 'auto', 'auto', '708px']);
    resize({ width: 1280, height: 800 });
    placement.apply();
    expect(inset()).toEqual(['700px', 'auto', 'auto', '1100px']);
    expect(saved).toEqual([]);
  });

  it('keeps the top of a card never moved where it was when the card opens', () => {
    const { placement, placeCard, inset } = setup();
    placement.apply();
    placeCard(0, 0, 280, 157);
    placement.apply();
    expect(inset()).toEqual(['383px', '16px', 'auto', 'auto']);
  });

  it('keeps a card that grew inside the window', () => {
    const { placement, placeCard, inset } = setup({
      horizontal: 'right',
      x: 16,
      vertical: 'top',
      y: 700,
    });
    placeCard(0, 0, 272, 220);
    placement.apply();
    expect(inset()).toEqual(['572px', '16px', 'auto', 'auto']);
  });

  it('keeps an opening card inside the window by its laid-out size, not the size its animation scales', () => {
    const { placement, placeCard, inset } = setup(
      { horizontal: 'left', x: 540, vertical: 'top', y: 133 },
      { width: 800, height: 500 },
    );
    // Mid-way through its opening animation (scale 0.97) the card's box on screen is smaller.
    placeCard(0, 0, 280, 157).mockReturnValue(new DOMRect(548.4, 135.4, 271.6, 152.3));
    placement.apply();
    expect(inset()).toEqual(['133px', 'auto', 'auto', '512px']);
  });

  it('moves the card with a transform while dragged, inside the window', () => {
    const { root, placement, placeCard } = setup();
    placeCard(1180, 384, 84, 32);
    placement.onStart();
    expect(root.dataset['dragging']).toBe('true');
    placement.onMove(-300, 100);
    expect(root.style.transform).toBe('translate(-300px, 100px)');
    placement.onMove(200, -1000);
    expect(root.style.transform).toBe('translate(16px, -384px)');
  });

  it('measures the card for a drag only once the drag stopped its opening animation', () => {
    const { root, placement, placeCard } = setup();
    const draggingWhenMeasured: (string | undefined)[] = [];
    placeCard(1000, 384, 280, 157).mockImplementation(() => {
      draggingWhenMeasured.push(root.dataset['dragging']);
      return new DOMRect(1000, 384, 280, 157);
    });
    placement.onStart();
    expect(draggingWhenMeasured).toEqual(['true']);
  });

  it('docks the dropped card to its nearest edges and remembers the place', () => {
    const { root, placement, placeCard, saved, inset } = setup();
    placeCard(1180, 384, 84, 32);
    placement.onStart();
    placement.onMove(-1100, 300);
    placement.onEnd();
    const dropped = { horizontal: 'left', x: 80, vertical: 'bottom', y: 84 };
    expect(saved).toEqual([dropped]);
    expect(root.style.transform).toBe('');
    expect(root.dataset['dragging']).toBeUndefined();
    placeCard(80, 684, 84, 32);
    placement.apply();
    expect(inset()).toEqual(['auto', 'auto', '84px', '80px']);
  });

  it('remembers a card dropped against an edge at the margin it is shown at', () => {
    const { placement, placeCard, saved } = setup();
    placeCard(1180, 384, 84, 32);
    placement.onStart();
    placement.onMove(500, 0);
    placement.onEnd();
    expect(saved).toEqual([{ horizontal: 'right', x: 8, vertical: 'top', y: 384 }]);
  });
});
