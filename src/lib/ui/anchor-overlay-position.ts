import type { Box, OverlayPosition, Size } from '@/lib/types';

/**
 * Docks the status card where it was dropped to the window edges nearest its centre, so it keeps
 * that place when the window grows and opens away from those edges.
 */
export function anchorOverlayPosition(rect: Box, viewport: Size): OverlayPosition {
  const right = rect.x + rect.width / 2 > viewport.width / 2;
  const bottom = rect.y + rect.height / 2 > viewport.height / 2;
  const px = (value: number) => Math.max(0, Math.round(value));
  return {
    horizontal: right ? 'right' : 'left',
    x: px(right ? viewport.width - rect.x - rect.width : rect.x),
    vertical: bottom ? 'bottom' : 'top',
    y: px(bottom ? viewport.height - rect.y - rect.height : rect.y),
  };
}
