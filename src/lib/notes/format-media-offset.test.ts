import { describe, expect, it } from 'vitest';
import { formatMediaOffset } from './format-media-offset';

describe('formatMediaOffset', () => {
  it.each<[number, string]>([
    [0, '0:00:00'],
    [999, '0:00:00'],
    [59_999, '0:00:59'],
    [61_000, '0:01:01'],
    [3_600_000, '1:00:00'],
    [36_000_000, '10:00:00'],
    [-500, '0:00:00'],
  ])('writes %i ms as %s', (ms, expected) => {
    expect(formatMediaOffset(ms)).toBe(expected);
  });
});
