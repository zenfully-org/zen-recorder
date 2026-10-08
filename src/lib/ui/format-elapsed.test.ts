import { describe, expect, it } from 'vitest';
import { formatElapsed } from './format-elapsed';

describe('formatElapsed', () => {
  it.each([
    [0, '00:00'],
    [999, '00:00'],
    [61_000, '01:01'],
    [3_599_000, '59:59'],
    [3_600_000, '1:00:00'],
    [45_296_000, '12:34:56'],
    [-5000, '00:00'],
  ])('%d ms → %s', (ms, expected) => {
    expect(formatElapsed(ms)).toBe(expected);
  });
});
