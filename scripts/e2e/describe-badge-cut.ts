import type { DrawnBadge } from './read-drawn-badge';

/**
 * What Firefox cuts off the toolbar badge's text, in words, or null when all of it shows: the
 * badge hides what overflows it, without an ellipsis, so a text wider than the badge loses its end.
 */
export function describeBadgeCut(drawn: DrawnBadge): string | null {
  if (drawn.scrollWidth <= drawn.clientWidth) return null;
  return `Firefox cuts the badge's "${drawn.text}": it needs ${drawn.scrollWidth} px, and the badge is ${drawn.clientWidth} px wide`;
}
