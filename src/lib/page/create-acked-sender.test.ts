import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAckedSender, type Delivery } from './create-acked-sender';

/** Deliveries of `items`, in order: each is acked by `answer`, and leaves the list once acked. */
function deliveries(items: string[], answer: (item: string) => Promise<unknown>) {
  const sent: string[] = [];
  const acked: string[] = [];
  const next = (): Delivery | null => {
    const item = items[0];
    if (item === undefined) return null;
    return {
      send: () => {
        sent.push(item);
        return answer(item);
      },
      acked: () => {
        items.shift();
        acked.push(item);
      },
    };
  };
  return { next, sent, acked };
}

const timers = {
  setTimeout: (handler: () => void, ms: number) => window.setTimeout(handler, ms),
  clearTimeout: (id: unknown) => window.clearTimeout(Number(id)),
};

describe('createAckedSender', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('delivers in order, one at a time, each once it is acked', async () => {
    const items = ['a', 'b', 'c'];
    const { next, sent, acked } = deliveries(items, async () => ({ ok: true }));
    const sender = createAckedSender({ next, ...timers });
    sender.kick();
    sender.kick(); // already running: no second run
    await sender.whenIdle();
    expect(sent).toEqual(['a', 'b', 'c']);
    expect(acked).toEqual(['a', 'b', 'c']);
  });

  it('sends the same delivery again a while after it failed', async () => {
    // The bridge's answer to a failed request is an Error; anything else thrown counts the same.
    const failures: unknown[] = [new Error('bridge down'), 'port closed'];
    const { next, sent, acked } = deliveries(['a'], async () => {
      if (failures.length > 0) throw failures.shift();
    });
    const sender = createAckedSender({ next, retryDelayMs: 1_000, ...timers });
    sender.kick();
    await vi.advanceTimersByTimeAsync(999);
    expect(sent).toEqual(['a']);
    await vi.advanceTimersByTimeAsync(1_001);
    await sender.whenIdle();
    expect(sent).toEqual(['a', 'a', 'a']);
    expect(acked).toEqual(['a']);
  });

  it('gives up on an answer that never comes and sends again', async () => {
    let answers = 0;
    const { next, sent, acked } = deliveries(['a'], () =>
      answers++ === 0 ? new Promise(() => undefined) : Promise.resolve(),
    );
    const sender = createAckedSender({
      next,
      ackTimeoutMs: 15_000,
      retryDelayMs: 1_000,
      ...timers,
    });
    sender.kick();
    await vi.advanceTimersByTimeAsync(16_000);
    await sender.whenIdle();
    expect(sent).toEqual(['a', 'a']);
    expect(acked).toEqual(['a']);
  });

  it('resolves idle at once when nothing was ever due', async () => {
    const sender = createAckedSender({ next: () => null, ...timers });
    await expect(sender.whenIdle()).resolves.toBeUndefined();
  });

  it("runs on the page's own timers when given none", async () => {
    vi.useRealTimers();
    const { next, acked } = deliveries(['a'], async () => undefined);
    const sender = createAckedSender({ next });
    sender.kick();
    await sender.whenIdle();
    expect(acked).toEqual(['a']);
  });
});

describe('createAckedSender, a run that finds nothing due', () => {
  // The owner kicks it with every new item; one that becomes due must not wait for a later kick.
  it('is over at once, so the next kick in the same task starts a run', async () => {
    const items: string[] = [];
    let due = false;
    const { next, sent } = deliveries(items, async () => undefined);
    const sender = createAckedSender({ next: () => (due ? next() : null), ...timers });
    sender.kick();
    items.push('a');
    due = true;
    sender.kick();
    await sender.whenIdle();
    expect(sent).toEqual(['a']);
  });
});
