import { describe, expect, it } from 'vitest';
import { formatNotesSpan } from './format-notes-span';

describe('formatNotesSpan', () => {
  it.each([
    // A restart comes within a fraction of a second: "0 s later" would read as no time at all.
    [0, 'under 1 s'],
    [-5, 'under 1 s'],
    [999, 'under 1 s'],
    [1_000, '1 s'],
    [3_999, '3 s'],
    [60_000, '1 min'],
    [90_000, '1 min 30 s'],
    [3_600_000, '1 h'],
    [3_900_000, '1 h 5 min'],
  ])('writes %i ms as %s', (ms, words) => {
    expect(formatNotesSpan(ms)).toBe(words);
  });
});
