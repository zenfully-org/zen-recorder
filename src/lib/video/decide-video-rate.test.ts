import { describe, expect, it } from 'vitest';
import type { RecentLoad } from './create-frame-stats';
import { decideVideoRate, type RateInput } from './decide-video-rate';

const load = (overrides: Partial<RecentLoad> = {}): RecentLoad => ({
  encodedPerS: 15,
  ticksPerS: 15,
  busyPerS: 0,
  mainMsPerFrame: 10,
  mainMsPerS: 150,
  waitMsPerFrame: 1,
  p95MainMs: 12,
  ...overrides,
});

const input = (overrides: Partial<RateInput> = {}): RateInput => ({
  fps: 15,
  nominalFps: 15,
  minFps: 5,
  load: load(),
  sinceChangeMs: 60_000,
  upgradeHoldMs: 20_000,
  ...overrides,
});

describe('decideVideoRate', () => {
  it.each<[string, Partial<RateInput>]>([
    ['a light load', {}],
    [
      'a heavy load right after a change (the window still shows the old rate)',
      { sinceChangeMs: 2_000, load: load({ mainMsPerFrame: 60, mainMsPerS: 900 }) },
    ],
    [
      'the floor rate under any load',
      { fps: 5, load: load({ ticksPerS: 5, mainMsPerFrame: 200, mainMsPerS: 1000 }) },
    ],
    [
      'a load close to but under every limit',
      { load: load({ mainMsPerFrame: 30, mainMsPerS: 450, busyPerS: 2, p95MainMs: 45 }) },
    ],
    [
      'long single frames alone (a lower rate would not make them shorter)',
      { load: load({ mainMsPerFrame: 20, mainMsPerS: 300, p95MainMs: 70 }) },
    ],
  ])('keeps the rate with %s', (_name, overrides) => {
    const decision = decideVideoRate(input(overrides));
    expect(decision).toEqual({ next: null, upgradeHoldMs: input(overrides).upgradeHoldMs });
  });

  // Rates are the configured rate divided by a whole number (15, 7.5, 5): the muxer puts every
  // timestamp on the configured rate's grid, so any other rate would make frames uneven.
  it.each<[string, Partial<RateInput>, number, string]>([
    [
      'too large a share of the main thread: to the highest rate that fits the budget',
      { load: load({ mainMsPerFrame: 40, mainMsPerS: 600 }) },
      7.5,
      'compositing takes 600 ms/s of the main thread (40 ms per frame)',
    ],
    [
      'a share of the main thread that only fits a much lower rate: several steps at once',
      { nominalFps: 30, fps: 30, load: load({ mainMsPerFrame: 40, mainMsPerS: 1200 }) },
      7.5,
      'compositing takes 1200 ms/s of the main thread (40 ms per frame)',
    ],
    [
      'an encoder that cannot keep up: to a rate it sustains',
      { load: load({ ticksPerS: 6, busyPerS: 9, encodedPerS: 6, waitMsPerFrame: 120 }) },
      5,
      'only 6 of 15 frames/s get through (frames wait 120 ms each)',
    ],
    [
      'an extreme load: never below the floor',
      { fps: 7.5, load: load({ ticksPerS: 7.5, mainMsPerFrame: 300, mainMsPerS: 2250 }) },
      5,
      'compositing takes 2250 ms/s of the main thread (300 ms per frame)',
    ],
  ])('lowers the rate for %s', (_name, overrides, fps, reason) => {
    expect(decideVideoRate(input(overrides)).next).toEqual({ fps, reason });
  });

  it('waits longer before each new attempt to go back up after lowering the rate', () => {
    const heavy = load({ mainMsPerFrame: 40, mainMsPerS: 600 });
    expect(decideVideoRate(input({ load: heavy })).upgradeHoldMs).toBe(40_000);
    expect(decideVideoRate(input({ load: heavy, upgradeHoldMs: 200_000 })).upgradeHoldMs).toBe(
      300_000,
    );
  });

  it('keeps the configured rate when it is below the floor', () => {
    const heavy = load({ ticksPerS: 3, mainMsPerFrame: 300, mainMsPerS: 900 });
    expect(decideVideoRate(input({ nominalFps: 3, fps: 3, load: heavy })).next).toBeNull();
  });

  it.each<[string, Partial<RateInput>, number | null]>([
    [
      'goes back up one step once the load at the higher rate fits the budget',
      { fps: 5, load: load({ ticksPerS: 5, encodedPerS: 5, mainMsPerFrame: 20, mainMsPerS: 100 }) },
      7.5,
    ],
    [
      'climbs to the configured rate, not beyond it',
      { fps: 7.5, load: load({ ticksPerS: 7.5, mainMsPerFrame: 5, mainMsPerS: 38 }) },
      15,
    ],
    [
      'does not go up before the hold time has passed',
      {
        fps: 5,
        sinceChangeMs: 19_000,
        load: load({ ticksPerS: 5, mainMsPerFrame: 5, mainMsPerS: 25 }),
      },
      null,
    ],
    [
      'does not go up when the higher rate would not fit the budget',
      { fps: 7.5, load: load({ ticksPerS: 7.5, mainMsPerFrame: 30, mainMsPerS: 225 }) },
      null,
    ],
    [
      'does not go up while ticks are still being skipped',
      { fps: 7.5, load: load({ ticksPerS: 7, busyPerS: 1, mainMsPerFrame: 5, mainMsPerS: 35 }) },
      null,
    ],
    [
      'does not go up while single frames are long',
      {
        fps: 7.5,
        load: load({ ticksPerS: 7.5, mainMsPerFrame: 5, mainMsPerS: 38, p95MainMs: 45 }),
      },
      null,
    ],
  ])('%s', (_name, overrides, expected) => {
    const decision = decideVideoRate(input(overrides));
    expect(decision.next).toEqual(
      expected === null ? null : { fps: expected, reason: 'the load allows a higher rate' },
    );
    expect(decision.upgradeHoldMs).toBe(input(overrides).upgradeHoldMs);
  });
});
