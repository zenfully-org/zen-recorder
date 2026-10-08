import type { OverlayPosition, Size } from '@/lib/types';

/**
 * Where the status card sits until the person moves it: on the right edge, its status row
 * centred vertically. Every service keeps its own controls in bars along the top and the bottom
 * of the window (Meet's bottom bar, Zoom's header and footer, Teams' top bar), and its side panels
 * open on the right below them; the middle of the right edge is part of the call's stage.
 */
export function getDefaultOverlayPosition(viewport: Size, rowHeight: number): OverlayPosition {
  return {
    horizontal: 'right',
    x: 16,
    vertical: 'top',
    y: Math.round((viewport.height - rowHeight) / 2),
  };
}
