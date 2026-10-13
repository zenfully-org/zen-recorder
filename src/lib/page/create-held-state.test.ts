import { describe, expect, it } from 'vitest';
import { createHeldState } from './create-held-state';

/** A state that must hold 2 s to count, except `true`, which counts at once. */
const connection = () =>
  createHeldState({ initial: true, holdMs: (connected: boolean) => (connected ? 0 : 2_000) });

/** A microphone whose every change must hold 4 s. */
const microphone = () => createHeldState({ initial: 'live', holdMs: () => 4_000 });

describe('createHeldState', () => {
  it('counts a change once it held long enough, as of the moment it was first seen', () => {
    const state = connection();
    expect(state.observe(false, 1_000, () => 'first seen')).toEqual([]);
    expect(state.observe(false, 2_500, () => 'later')).toEqual([]);
    expect(state.observe(false, 3_000, () => 'later still')).toEqual([
      { value: false, seen: 'first seen', from: true },
    ]);
    // Once, and not again while it holds.
    expect(state.observe(false, 9_000, () => 'again')).toEqual([]);
  });

  it('forgets a change that went back before it held', () => {
    const state = connection();
    state.observe(false, 1_000, () => 'blip');
    expect(state.observe(true, 2_000, () => 'back')).toEqual([]);
    expect(state.observe(false, 2_500, () => 'new loss')).toEqual([]);
    expect(state.observe(false, 4_500, () => 'held')).toMatchObject([{ seen: 'new loss' }]);
  });

  it('counts a change that needs no hold at once', () => {
    const state = connection();
    state.observe(false, 0, () => 'lost');
    state.observe(false, 2_000, () => 'held');
    expect(state.observe(true, 5_000, () => 'back')).toEqual([
      { value: true, seen: 'back', from: false },
    ]);
  });

  // The page observes when it runs: once a second, later on a busy page. A 5 s mute whose end
  // came before any observation after its fourth second still held 4 s.
  it('counts a change that held long enough by the observation that ends it', () => {
    const state = microphone();
    expect(state.observe('muted', 0, () => 'muted at 0')).toEqual([]);
    expect(state.observe('muted', 1_400, () => 'tick')).toEqual([]);
    expect(state.observe('muted', 3_900, () => 'tick')).toEqual([]);
    expect(state.observe('live', 5_000, () => 'live at 5')).toEqual([
      { value: 'muted', seen: 'muted at 0', from: 'live' },
    ]);
    // What ended it starts a hold of its own there.
    expect(state.observe('live', 8_900, () => 'tick')).toEqual([]);
    expect(state.observe('live', 9_000, () => 'tick')).toEqual([
      { value: 'live', seen: 'live at 5', from: 'muted' },
    ]);
  });

  it('counts a change that held, and the one that ended it, at once when that one needs no hold', () => {
    const state = connection();
    state.observe(false, 1_000, () => 'lost');
    expect(state.observe(true, 3_500, () => 'back')).toEqual([
      { value: false, seen: 'lost', from: true },
      { value: true, seen: 'back', from: false },
    ]);
  });

  it('starts a new hold when another value comes before the first one held', () => {
    const state = microphone();
    state.observe('muted', 0, () => 'muted at 0');
    expect(state.observe('not-connected', 3_000, () => 'gone at 3')).toEqual([]);
    expect(state.observe('not-connected', 7_000, () => 'later')).toEqual([
      { value: 'not-connected', seen: 'gone at 3', from: 'live' },
    ]);
  });

  it('counts a change another value ended once it held, and holds the other from there', () => {
    const state = microphone();
    state.observe('muted', 0, () => 'muted at 0');
    expect(state.observe('not-connected', 4_500, () => 'gone at 4.5')).toEqual([
      { value: 'muted', seen: 'muted at 0', from: 'live' },
    ]);
    expect(state.observe('not-connected', 8_500, () => 'later')).toEqual([
      { value: 'not-connected', seen: 'gone at 4.5', from: 'muted' },
    ]);
  });

  // Nothing is observed after a stop: a change that held until it counts.
  it('says the change a value still holding at a moment makes, without counting it', () => {
    const state = microphone();
    expect(state.heldBy(9_000)).toBeNull();
    state.observe('muted', 1_000, () => 'muted at 1');
    expect(state.heldBy(4_999)).toBeNull();
    const change = { value: 'muted', seen: 'muted at 1', from: 'live' };
    expect(state.heldBy(5_000)).toEqual(change);
    // Asked again, as a stop Firefox cut short asks it again.
    expect(state.heldBy(5_000)).toEqual(change);
    expect(state.observe('muted', 5_000, () => 'tick')).toEqual([change]);
    expect(state.heldBy(9_000)).toBeNull();
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

  // Push-to-talk flips between on and muted for a second or two; leaving the call's audio is longer.
  it('holds a change by what it changes from, too', () => {
    const quick = (to: string, from: string) =>
      [to, from].every((state) => state === 'live' || state === 'muted') ? 1_000 : 4_000;
    const state = createHeldState({ initial: 'live', holdMs: quick });
    state.observe('muted', 0, () => 'muted at 0');
    expect(state.observe('muted', 1_000, () => 'later')).toMatchObject([{ value: 'muted' }]);
    state.observe('not-connected', 2_000, () => 'gone at 2');
    expect(state.observe('not-connected', 5_000, () => 'later')).toEqual([]);
    expect(state.observe('not-connected', 6_000, () => 'later')).toMatchObject([
      { value: 'not-connected', from: 'muted' },
    ]);
  });
});
