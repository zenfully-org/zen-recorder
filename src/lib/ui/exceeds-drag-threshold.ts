/**
 * How far, in CSS pixels, a pressed pointer moves before the press is a drag rather than a
 * click. A hand clicking a button moves it a pixel or two.
 */
const DRAG_THRESHOLD = 5;

/** True once a pointer pressed at `start` has moved far enough to drag the status card. */
export function exceedsDragThreshold(
  start: { x: number; y: number },
  point: { x: number; y: number },
): boolean {
  return Math.hypot(point.x - start.x, point.y - start.y) >= DRAG_THRESHOLD;
}
