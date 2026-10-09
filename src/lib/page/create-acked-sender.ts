/**
 * Delivers what the page must not lose to the bridge, strictly in order, one delivery at a time:
 * each is sent until the bridge answers it, then the next. An outage (the extension reloading, the
 * background's Port down) only delays them: a send that fails is sent again a second later, and
 * one whose answer does not come within 15 s counts as failed. What goes next, and what an answer
 * settles, is the owner's (`next`): the recording's chunks and end, or its meeting events.
 */

/** One delivery: sent until the bridge answers, then `acked`. */
export interface Delivery {
  send(): Promise<unknown>;
  acked(): void;
}

export interface AckedSender {
  /** Starts delivering what `next` hands out, unless a run is under way. */
  kick(): void;
  /** Resolves once the current run is over: `next` handed out nothing more. */
  whenIdle(): Promise<void>;
}

export interface AckedSenderOptions {
  /** What to deliver now; null when nothing is due. Asked again after every answer. */
  next(): Delivery | null;
  ackTimeoutMs?: number;
  retryDelayMs?: number;
  setTimeout?: (handler: () => void, ms: number) => unknown;
  clearTimeout?: (id: unknown) => void;
}

/** Schedules `handler` in `ms` and returns its cancel function. */
type Schedule = (handler: () => void, ms: number) => () => void;

/** `promise`, or an "ack timeout" error once `ms` passed without it settling. */
const withTimeout = <T>(promise: Promise<T>, schedule: Schedule, ms: number): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    const cancel = schedule(() => reject(new Error('ack timeout')), ms);
    promise.then(
      (value) => {
        cancel();
        resolve(value);
      },
      (error: unknown) => {
        cancel();
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });

/** With the injected timers, or the globals. */
const scheduleWith =
  ({ setTimeout: inject, clearTimeout: cancel }: AckedSenderOptions): Schedule =>
  (handler, ms) => {
    if (inject) {
      const id = inject(handler, ms);
      return () => cancel?.(id);
    }
    // Wrapped so calling them unbound never trips Firefox's "illegal invocation" on the globals.
    const id = setTimeout(handler, ms);
    return () => clearTimeout(id);
  };

export function createAckedSender(options: AckedSenderOptions): AckedSender {
  const ackTimeoutMs = options.ackTimeoutMs ?? 15_000;
  const retryDelayMs = options.retryDelayMs ?? 1_000;
  const schedule = scheduleWith(options);
  let running = false;
  let idle: Promise<void> = Promise.resolve();

  const run = async (): Promise<void> => {
    try {
      for (let delivery = options.next(); delivery; delivery = options.next()) {
        try {
          await withTimeout(delivery.send(), schedule, ackTimeoutMs);
          delivery.acked();
        } catch {
          await new Promise<void>((resolve) => schedule(resolve, retryDelayMs));
        }
      }
    } finally {
      // In the same task as the last `next()`: a run that found nothing due is over before the
      // caller's next `kick()`, which then starts one (a promise's `finally` would come too late).
      running = false;
    }
  };

  return {
    kick() {
      if (running) return;
      running = true;
      idle = run();
    },
    whenIdle: () => idle,
  };
}
