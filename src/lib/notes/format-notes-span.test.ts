import { describe, expect, it } from 'vitest';
import { formatNotesSpan } from './format-notes-span';

describe('formatNotesSpan', () => {
  it.each([
    [0, '0 s'],
    [-5, '0 s'],
    [3_999, '3 s'],
    [60_000, '1 min'],
    [90_000, '1 min 30 s'],
    [3_600_000, '1 h'],
    [3_900_000, '1 h 5 min'],
  ])('writes %i ms as %s', (ms, words) => {
    expect(formatNotesSpan(ms)).toBe(words);
  });
});
