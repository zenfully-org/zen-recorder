import { describe, expect, it } from 'vitest';
import { parseOverlayPosition } from './parse-overlay-position';

describe('parseOverlayPosition', () => {
  it('accepts a stored position', () => {
    const position = { horizontal: 'left', x: 24, vertical: 'bottom', y: 120.5 };
    expect(parseOverlayPosition(position)).toEqual(position);
  });

  it('drops fields it does not know', () => {
    expect(
      parseOverlayPosition({ horizontal: 'right', x: 0, vertical: 'top', y: 0, extra: true }),
    ).toEqual({ horizontal: 'right', x: 0, vertical: 'top', y: 0 });
  });

  it.each([
    ['nothing stored', undefined],
    ['null', null],
    ['a string', 'right'],
    ['an unknown edge', { horizontal: 'middle', x: 1, vertical: 'top', y: 1 }],
    ['a missing distance', { horizontal: 'left', vertical: 'top', y: 1 }],
    ['a negative distance', { horizontal: 'left', x: -5, vertical: 'top', y: 1 }],
    ['an infinite distance', { horizontal: 'left', x: 1, vertical: 'top', y: Infinity }],
    ['a distance that is not a number', { horizontal: 'left', x: '4', vertical: 'top', y: 1 }],
  ])('rejects %s', (_label, input) => {
    expect(parseOverlayPosition(input)).toBeNull();
  });
});
