import { describe, expect, it } from 'vitest';
import { createPauseTally } from './create-pause-tally';

describe('createPauseTally', () => {
  it('counts each pause of a recording as it ends, and their total', () => {
    const tally = createPauseTally();
    tally.paused('r1', 1_000);
    expect(tally.ended('r1', 5_000)).toBe(4_000);
    tally.paused('r1', 8_000);
    // Pressed twice: the pause still began at the first.
    tally.paused('r1', 9_000);
    expect(tally.ended('r1', 10_000)).toBe(2_000);
    expect(tally.total('r1')).toBe(6_000);
  });

  // A recording stopped while paused: the stop ends the pause.
  it('ends nothing when no pause is open, and keeps recordings apart', () => {
    const tally = createPauseTally();
    tally.paused('r1', 0);
    expect(tally.ended('r2', 3_000)).toBe(0);
    expect(tally.ended('r1', 3_000)).toBe(3_000);
    expect(tally.ended('r1', 9_000)).toBe(0);
    expect(tally.total('r1')).toBe(3_000);
    expect(tally.total('r2')).toBe(0);
  });

  it('counts no negative pause when the clock went back', () => {
    const tally = createPauseTally();
    tally.paused('r1', 10_000);
    expect(tally.ended('r1', 4_000)).toBe(0);
  });
});
