import { describe, expect, it } from 'vitest';
import { countTimes } from './count-times';

describe('countTimes', () => {
  it.each([
    [1, 'once'],
    [2, 'twice'],
    [3, '3 times'],
    [12, '12 times'],
  ])('writes %i as %s', (count, words) => {
    expect(countTimes(count)).toBe(words);
  });
});
