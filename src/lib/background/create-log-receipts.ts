/**
 * The page log lines a meeting tab's bridge relays, written to Diagnostics once each. The bridge
 * numbers its lines and posts one again until it is acked, because a Port the background drops
 * loses what is on its way; so a line can come twice, and only the first is written. A line sent
 * again comes after the ones posted later on the new Port, so the numbers written are remembered
 * one by one, not as a highest one. Every line with a number is acked. A line carries the time the
 * bridge got it, which Diagnostics keep.
 */
import type { BackgroundToTab, LogReceipt, PageLog } from '@/lib/types';

/** A log line as the background writes it: when the bridge got it, if it says. */
export type ReceivedLog = PageLog & { at?: number };

export interface LogReceipts {
  receive(
    tabId: number,
    message: { log: PageLog; at?: number | undefined; receipt?: LogReceipt | undefined },
    post: (ack: BackgroundToTab) => void,
  ): void;
}

/** How many numbers of a tab's bridge are remembered; the lowest are forgotten first. */
const REMEMBERED = 1000;

export function createLogReceipts(
  onLog: ((log: ReceivedLog, tabId: number) => void) | undefined,
  remembered = REMEMBERED,
): LogReceipts {
  /** Per tab, its bridge and the numbers written: a new bridge numbers from 1 again. */
  const written = new Map<number, { bridge: string; seqs: Set<number> }>();
  /** Whether the line was written already; remembers it when it was not. */
  const seen = (tabId: number, { bridge, seq }: LogReceipt): boolean => {
    const known = written.get(tabId);
    if (known?.bridge !== bridge) {
      written.set(tabId, { bridge, seqs: new Set([seq]) });
      return false;
    }
    if (known.seqs.has(seq)) return true;
    known.seqs.add(seq);
    if (known.seqs.size > remembered) known.seqs.delete(Math.min(...known.seqs));
    return false;
  };
  return {
    receive(tabId, { log, at, receipt }, post) {
      if (!receipt || !seen(tabId, receipt))
        onLog?.(at === undefined ? log : { ...log, at }, tabId);
      if (receipt) post({ type: 'logAck', seq: receipt.seq });
    },
  };
}
