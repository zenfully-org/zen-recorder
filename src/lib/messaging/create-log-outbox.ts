/**
 * The bridge's log lines on their way to the background's Diagnostics. A Port that is down drops
 * what is posted on it, and so does a Port the background drops while a line is on its way (an
 * event page restart), without an error: around such a restart the lines that explain it were the
 * ones missing. So each line gets the time the bridge got it and a number, and is kept until the
 * background acks that number; a line not acked a few seconds after it was posted is posted again,
 * on whatever Port there is by then. The background writes each number once.
 */
import type { LogReceipt, PageLog, TabToBackground } from '@/lib/types';

/** A line not acked this long after it was posted is posted again. */
const RESEND_MS = 5_000;
/** At most this many lines are kept; the oldest give way, and a line says how many. */
const MAX_KEPT = 200;

export interface LogOutbox {
  send(log: PageLog): void;
  /**
   * The background wrote the line with this number. Only that one: after a Port was dropped, the
   * lines that came later arrive first, and their acks say nothing of the one it lost.
   */
  acked(seq: number): void;
  dispose(): void;
}

export interface LogOutboxDeps {
  /** Posts on the Port; false when there is none. */
  send: (message: TabToBackground) => boolean;
  bridgeId: string;
  now: () => number;
  setInterval: (handler: () => void, ms: number) => number;
  clearInterval: (id: number) => void;
  max?: number;
}

interface Kept {
  message: { type: 'log'; log: PageLog; at: number; receipt: LogReceipt };
  postedAt: number;
}

export function createLogOutbox(deps: LogOutboxDeps): LogOutbox {
  const max = deps.max ?? MAX_KEPT;
  const kept: Kept[] = [];
  let lastSeq = 0;
  let dropped = 0;

  const entry = (log: PageLog): Kept => ({
    message: {
      type: 'log',
      log,
      at: deps.now(),
      receipt: { bridge: deps.bridgeId, seq: ++lastSeq },
    },
    postedAt: 0,
  });
  const post = (line: Kept): void => {
    line.postedAt = deps.now();
    deps.send(line.message);
  };

  const resend = (): void => {
    if (dropped > 0) {
      const message = `${dropped} log lines of this tab were dropped while the extension was not taking them`;
      dropped = 0;
      kept.push(entry({ level: 'warn', message }));
    }
    const due = deps.now() - RESEND_MS;
    for (const line of kept) if (line.postedAt <= due) post(line);
  };
  const timer = deps.setInterval(resend, RESEND_MS);

  return {
    send(log) {
      const line = entry(log);
      kept.push(line);
      if (kept.length > max) dropped += kept.splice(0, kept.length - max).length;
      post(line);
    },
    acked(seq) {
      const pending = kept.filter((line) => line.message.receipt.seq !== seq);
      kept.splice(0, kept.length, ...pending);
    },
    dispose() {
      deps.clearInterval(timer);
    },
  };
}
