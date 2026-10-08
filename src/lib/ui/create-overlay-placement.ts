import type { Box, OverlayPosition, Size } from '@/lib/types';
import { anchorOverlayPosition } from '@/lib/ui/anchor-overlay-position';
import { clampOverlayPosition } from '@/lib/ui/clamp-overlay-position';
import type { OverlayDragHandlers } from '@/lib/ui/create-overlay-drag';
import { getDefaultOverlayPosition } from '@/lib/ui/get-default-overlay-position';

export interface OverlayPlacementDeps {
  /** Where the person left the card on this service; null until they move it. */
  position: OverlayPosition | null;
  /** The size of the area the card is placed in: the window without its scrollbars. */
  viewport: () => Size;
  /** Called with the card's new place once a drag ends. */
  onPositionChange: (position: OverlayPosition) => void;
}

/** Puts the status card on the page, and moves it while it is dragged. */
export interface OverlayPlacement extends OverlayDragHandlers {
  /** Places the card for its current size and the window's: at load, on a resize, on a change. */
  apply(): void;
}

/** A drag under way: where the card started, how far it may move each way, where it is now. */
interface Drag {
  start: Box;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  moved: Box;
}

const OPPOSITE = { left: 'right', right: 'left', top: 'bottom', bottom: 'top' } as const;
/**
 * The compact card's height: its 32 px status row and 1 px borders (see the stylesheet). The
 * default place centres the compact card, and keeps its top there when the card opens, so the
 * status row never moves under the pointer that clicked it.
 */
const COMPACT_HEIGHT = 34;
const NOWHERE: Box = { x: 0, y: 0, width: 0, height: 0 };

/**
 * Places the root that holds the card, docked by the card's position. A drag moves the root with
 * a transform only (no layout while the pointer moves) and reads the card's size once, at its
 * start; the drop docks the card to its nearest edges and reports the new place.
 */
export function createOverlayPlacement(
  elements: { root: HTMLElement; card: HTMLElement },
  deps: OverlayPlacementDeps,
): OverlayPlacement {
  const { root, card } = elements;
  let stored = deps.position;
  let drag: Drag = { start: NOWHERE, minX: 0, maxX: 0, minY: 0, maxY: 0, moved: NOWHERE };

  const place = (position: OverlayPosition): void => {
    root.dataset['horizontal'] = position.horizontal;
    root.dataset['vertical'] = position.vertical;
    root.style.setProperty(position.horizontal, `${position.x}px`);
    root.style.setProperty(OPPOSITE[position.horizontal], 'auto');
    root.style.setProperty(position.vertical, `${position.y}px`);
    root.style.setProperty(OPPOSITE[position.vertical], 'auto');
  };
  const apply = (): void => {
    const viewport = deps.viewport();
    const wanted = stored ?? getDefaultOverlayPosition(viewport, COMPACT_HEIGHT);
    // The laid-out size: the box on screen is scaled while the card plays its opening animation.
    const size = { width: card.offsetWidth, height: card.offsetHeight };
    place(clampOverlayPosition(wanted, size, viewport));
  };
  const within = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

  return {
    apply,
    onStart() {
      // First: the drag state stops the card's opening animation, whose scale the rect would include.
      root.dataset['dragging'] = 'true';
      const start = card.getBoundingClientRect();
      const { width, height } = deps.viewport();
      drag = {
        start,
        minX: -start.x,
        maxX: width - start.x - start.width,
        minY: -start.y,
        maxY: height - start.y - start.height,
        moved: start,
      };
    },
    onMove(dx, dy) {
      const x = within(dx, drag.minX, drag.maxX);
      const y = within(dy, drag.minY, drag.maxY);
      root.style.transform = `translate(${x}px, ${y}px)`;
      const { start } = drag;
      drag.moved = { x: start.x + x, y: start.y + y, width: start.width, height: start.height };
    },
    onEnd() {
      const viewport = deps.viewport();
      const { moved } = drag;
      stored = clampOverlayPosition(anchorOverlayPosition(moved, viewport), moved, viewport);
      root.style.transform = '';
      delete root.dataset['dragging'];
      apply();
      deps.onPositionChange(stored);
    },
  };
}
