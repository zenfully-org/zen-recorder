import { describe, expect, it } from 'vitest';
import { exceedsDragThreshold } from './exceeds-drag-threshold';

describe('exceedsDragThreshold', () => {
  it.each([
    ['a click that does not move', 0, 0, false],
    ['a hand that shakes by a few pixels', 3, -3, false],
    ['a move just under the threshold', 4.9, 0, false],
    ['a move of the threshold', 0, 5, true],
    ['a diagonal move past it', 4, 4, true],
    ['a long drag', -120, 40, true],
  ])('%s', (_label, dx, dy, dragging) => {
    expect(exceedsDragThreshold({ x: 100, y: 100 }, { x: 100 + dx, y: 100 + dy })).toBe(dragging);
  });
});
