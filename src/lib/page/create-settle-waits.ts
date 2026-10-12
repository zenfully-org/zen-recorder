/**
 * Waits that end once, whichever comes first: what they wait for is done, their longest wait ran
 * out, or `settleNow`, for a page that goes away and runs no later task. Each calls its `done`
 * before it is forgotten, so a page stopped between the two settles it again, harmlessly.
 */
export function createSettleWaits(deps: {
  setTimeout: (handler: () => void, ms: number) => unknown;
}) {
  const waiting = new Set<() => void>();
  return {
    /** Calls `done` once: when `until` resolves, after `maxWaitMs`, or on `settleNow`. */
    add(until: Promise<unknown>, maxWaitMs: number, done: () => void): void {
      const settle = (): void => {
        if (!waiting.has(settle)) return;
        done();
        waiting.delete(settle);
      };
      waiting.add(settle);
      deps.setTimeout(settle, maxWaitMs);
      void until.then(settle);
    },
    /** Settles every wait now, in this task. */
    settleNow(): void {
      for (const settle of waiting) settle();
    },
  };
}
