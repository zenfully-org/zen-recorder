import { describe, expect, it } from 'vitest';
import { placeInFile } from './place-in-file';

describe('placeInFile', () => {
  const file = { mediaOffsetMs: 10, durationMs: 1000 };

  it('takes the start offset off', () => {
    expect(placeInFile(510, file)).toEqual({ mediaMs: 500 });
  });

  it('places a position before the file at its start', () => {
    expect(placeInFile(4, file)).toEqual({ mediaMs: 0 });
  });

  it('places a position past the end at the end, and says so', () => {
    expect(placeInFile(2000, file)).toEqual({ mediaMs: 1000, clamped: true });
  });

  it('places nothing at an end it does not know', () => {
    expect(placeInFile(2000, { mediaOffsetMs: 0, durationMs: null })).toEqual({ mediaMs: 2000 });
  });
});
