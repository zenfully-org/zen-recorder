import { describe, expect, it } from 'vitest';
import { createHeldState } from './create-held-state';

/** A state that must hold 2 s to count, except `true`, which counts at once. */
const connection = () =>
  createHeldState({ initial: true, holdMs: (connected: boolean) => (connected ? 0 : 2_000) });

describe('createHeldState', () => {
  it('counts a change once it held long enough, as of the moment it was first seen', () => {
    const state = connection();
    expect(state.observe(false, 1_000, () => 'first seen')).toBeNull();
    expect(state.observe(false, 2_500, () => 'later')).toBeNull();
    expect(state.observe(false, 3_000, () => 'later still')).toEqual({
      value: false,
      seen: 'first seen',
      from: true,
    });
    // Once, and not again while it holds.
    expect(state.observe(false, 9_000, () => 'again')).toBeNull();
  });

  it('forgets a change that went back before it held', () => {
    const state = connection();
    state.observe(false, 1_000, () => 'blip');
    expect(state.observe(true, 2_000, () => 'back')).toBeNull();
    expect(state.observe(false, 2_500, () => 'new loss')).toBeNull();
    expect(state.observe(false, 4_500, () => 'held')).toMatchObject({ seen: 'new loss' });
  });

  it('counts a change that needs no hold at once', () => {
    const state = connection();
    state.observe(false, 0, () => 'lost');
    state.observe(false, 2_000, () => 'held');
    expect(state.observe(true, 5_000, () => 'back')).toEqual({
      value: true,
      seen: 'back',
      from: false,
    });
  });

  it('starts a new hold when another value comes before the first one held', () => {
    const state = createHeldState({ initial: 'live', holdMs: () => 4_000 });
    state.observe('muted', 0, () => 'muted at 0');
    expect(state.observe('not-connected', 3_000, () => 'gone at 3')).toBeNull();
    expect(state.observe('not-connected', 7_000, () => 'later')).toEqual({
      value: 'not-connected',
      seen: 'gone at 3',
      from: 'live',
    });
  });

  it('reads what it remembers of a moment only when a change is first seen', () => {
    const state = connection();
    let reads = 0;
    const seen = () => {
      reads += 1;
      return reads;
    };
    state.observe(true, 0, seen);
    state.observe(false, 1, seen);
    state.observe(false, 2, seen);
    expect(reads).toBe(1);
  });
});
