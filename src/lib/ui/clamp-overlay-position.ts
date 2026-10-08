import type { OverlayPosition, Size } from '@/lib/types';

/** The least distance between the status card and a window edge, in CSS pixels. */
const MARGIN = 8;

/**
 * Keeps a card of `size` inside the window. A position remembered in a larger window, or a card
 * that grew, comes back in; the stored position is left as it was, so a larger window gets it
 * back. In a window smaller than the card, the docked edge stays in view.
 */
export function clampOverlayPosition(
  position: OverlayPosition,
  size: Size,
  viewport: Size,
): OverlayPosition {
  const keepIn = (value: number, room: number) => Math.max(MARGIN, Math.min(value, room - MARGIN));
  return {
    ...position,
    x: keepIn(position.x, viewport.width - size.width),
    y: keepIn(position.y, viewport.height - size.height),
  };
}
