import { describe, expect, it } from 'vitest';
import { getDefaultOverlayPosition } from './get-default-overlay-position';

describe('getDefaultOverlayPosition', () => {
  it("centres the status row on the window's right edge, clear of the services' top and bottom bars", () => {
    expect(getDefaultOverlayPosition({ width: 1280, height: 800 }, 32)).toEqual({
      horizontal: 'right',
      x: 16,
      vertical: 'top',
      y: 384,
    });
  });

  it('rounds to whole pixels', () => {
    expect(getDefaultOverlayPosition({ width: 500, height: 451 }, 32).y).toBe(210);
  });
});
