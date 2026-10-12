import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSettleWaits } from './create-settle-waits';

describe('createSettleWaits', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const setup = () =>
    createSettleWaits({ setTimeout: (handler, ms) => window.setTimeout(handler, ms) });

  it('settles a wait once what it waits for is done, with what it reads then', async () => {
    const waits = setup();
    const settled: number[] = [];
    let count = 1;
    waits.add(Promise.resolve(), 5_000, () => settled.push(count));
    count = 2;
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toEqual([2]);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(settled).toEqual([2]);
  });

  it('settles a wait after its longest wait, or at once on settleNow, and each once', async () => {
    const waits = setup();
    const settled: string[] = [];
    const never = new Promise<void>(() => undefined);
    waits.add(never, 5_000, () => settled.push('timed out'));
    waits.add(never, 60_000, () => settled.push('now'));
    await vi.advanceTimersByTimeAsync(5_000);
    expect(settled).toEqual(['timed out']);
    waits.settleNow();
    waits.settleNow();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(settled).toEqual(['timed out', 'now']);
  });
});
