import { exceedsDragThreshold } from '@/lib/ui/exceeds-drag-threshold';

export interface OverlayDragHandlers {
  /** The press became a drag: the card is about to move. */
  onStart: () => void;
  /** The pointer is now (dx, dy) CSS pixels from where it was pressed. */
  onMove: (dx: number, dy: number) => void;
  /** The drag is over (released, or cancelled by the browser): the card stays where it is. */
  onEnd: () => void;
}

interface Press {
  pointerId: number;
  x: number;
  y: number;
  dragging: boolean;
}

/**
 * Makes `surface` draggable by any part of it, buttons included. A press becomes a drag only once
 * the pointer moved past a small threshold, so a click stays a click; and the click a browser
 * fires when the drag ends is swallowed, so dragging never presses a button.
 *
 * The pointer is captured on the pressed element itself: the card follows a fast pointer that
 * leaves it, and the click after a short press still lands on that element (captured on the
 * surface, it would land on the surface instead).
 */
export function createOverlayDrag(surface: HTMLElement, handlers: OverlayDragHandlers): void {
  let press: Press | null = null;
  let swallowClick = false;
  const own = (event: PointerEvent): Press | null =>
    press?.pointerId === event.pointerId ? press : null;
  const finish = (event: PointerEvent): boolean => {
    const current = own(event);
    if (!current) return false;
    press = null;
    if (current.dragging) handlers.onEnd();
    return current.dragging;
  };

  surface.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || press) return;
    press = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, dragging: false };
    swallowClick = false;
    const pressed = event.target instanceof Element ? event.target : surface;
    pressed.setPointerCapture(event.pointerId);
  });
  surface.addEventListener('pointermove', (event) => {
    const current = own(event);
    if (!current) return;
    const point = { x: event.clientX, y: event.clientY };
    if (!current.dragging && !exceedsDragThreshold(current, point)) return;
    if (!current.dragging) handlers.onStart();
    current.dragging = true;
    handlers.onMove(point.x - current.x, point.y - current.y);
  });
  surface.addEventListener('pointerup', (event) => {
    swallowClick = finish(event);
  });
  surface.addEventListener('pointercancel', finish);
  surface.addEventListener('lostpointercapture', finish);
  surface.addEventListener(
    'click',
    (event) => {
      // `detail` is 0 for a click from the keyboard, which no drag ever precedes.
      if (!swallowClick || event.detail === 0) return;
      swallowClick = false;
      event.preventDefault();
      event.stopImmediatePropagation();
    },
    { capture: true },
  );
}
