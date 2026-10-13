// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { letPageRun } from './let-page-run';

/**
 * A clock the waits advance, and a page whose answers take the given times in turn (then come at
 * once): what `letPageRun` sees of a page that runs, or that a freeze holds for a while.
 */
function fakePage(answerMs: number[]) {
  let now = 0;
  const pings: number[] = [];
  const deps = {
    now: () => now,
    sleep: async (ms: number) => {
      now += ms;
    },
    ping: async () => {
      pings.push(now);
      now += answerMs.shift() ?? 2;
    },
  };
  return { deps, pings, elapsed: () => now };
}

describe('letPageRun', () => {
  it('waits the time asked for while the page answers at once', async () => {
    const page = fakePage([]);
    await letPageRun(5_000, page.deps);
    expect(page.elapsed()).toBeGreaterThanOrEqual(5_000);
    expect(page.elapsed()).toBeLessThan(5_000 + 250);
  });

  it('asks the page every 250 ms, so a freeze is seen within a ping of when it began', async () => {
    const page = fakePage([]);
    await letPageRun(1_000, page.deps);
    expect(page.pings.slice(0, 3)).toEqual([250, 502, 754]);
  });

  it('counts the time asked for again from when a frozen page ran again', async () => {
    // The fourth ping waits 10 s: a canvas snapshot holds the page until Firefox's timeout.
    const page = fakePage([2, 2, 2, 10_000]);
    await letPageRun(7_000, page.deps);
    const ranAgainAt = 4 * 250 + 3 * 2 + 10_000;
    expect(page.elapsed()).toBeGreaterThanOrEqual(ranAgainAt + 7_000);
    expect(page.elapsed()).toBeLessThan(ranAgainAt + 7_000 + 250);
  });

  it('takes an answer up to 1 s late for a page that ran', async () => {
    const page = fakePage([2, 1_000, 2]);
    await letPageRun(3_000, page.deps);
    expect(page.elapsed()).toBeLessThan(3_000 + 250);
  });

  it('gives up 30 s past the time asked for when the page never answers in time', async () => {
    const page = fakePage(Array.from({ length: 100 }, () => 1_500));
    await letPageRun(3_000, page.deps);
    expect(page.elapsed()).toBeGreaterThanOrEqual(33_000);
    expect(page.elapsed()).toBeLessThan(33_000 + 250 + 1_500);
  });
});
