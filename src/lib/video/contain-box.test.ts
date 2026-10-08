import { describe, expect, it } from 'vitest';
import { containBox } from './contain-box';

describe('containBox', () => {
  it('centres wide content between bars above and below', () => {
    expect(containBox({ x: 10, y: 20, width: 800, height: 800 }, 1600, 900)).toEqual({
      x: 10,
      y: 195,
      width: 800,
      height: 450,
    });
  });

  it('centres tall content between bars left and right', () => {
    expect(containBox({ x: 0, y: 0, width: 1000, height: 500 }, 500, 500)).toEqual({
      x: 250,
      y: 0,
      width: 500,
      height: 500,
    });
  });

  it('keeps a box that already has the content aspect', () => {
    const box = { x: 5, y: 6, width: 320, height: 180 };
    expect(containBox(box, 1920, 1080)).toEqual(box);
  });

  it.each([
    [{ x: 1, y: 2, width: 300, height: 200 }, 0, 100],
    [{ x: 1, y: 2, width: 300, height: 200 }, 100, 0],
    [{ x: 1, y: 2, width: 0, height: 200 }, 100, 100],
    [{ x: 1, y: 2, width: 300, height: 0 }, 100, 100],
  ])('returns the box itself when there is nothing to fit (%j, %i×%i)', (box, width, height) => {
    expect(containBox(box, width, height)).toEqual(box);
  });
});
