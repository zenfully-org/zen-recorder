/**
 * A recording's connection events, for its notes: `connection-lost` once every connection of the
 * call has been down for 2 s, stamped when it went down, and `connection-restored` with how long it
 * was lost once one is back. A shorter loss tells nothing: the connection-loss rule ends a
 * recording only after 5 s, and a blip says nothing about the file. The connection at the start is
 * the baseline, so a recording started before the call connected lost nothing.
 */
import { createHeldState } from '@/lib/page/create-held-state';
import type { MeetingEventBody } from '@/lib/types';

/** How long every connection must be down before the notes say the connection was lost. */
const LOST_AFTER_MS = 2_000;

/** An event to write, with what was remembered of the moment it happened. */
interface Told<Stamp> {
  stamp: Stamp;
  body: Extract<MeetingEventBody, { type: 'connection-lost' | 'connection-restored' }>;
}

/** `connected`: whether any connection was up as the recording started. */
export function createConnectionEvents<Stamp extends { atMs: number }>(connected: boolean) {
  const state = createHeldState<boolean, Stamp>({
    initial: connected,
    holdMs: (up) => (up ? 0 : LOST_AFTER_MS),
  });
  let lost: Stamp | null = null;
  return {
    /** Whether any connection is up at `atMs`; `stamp` remembers the moment. */
    observe(up: boolean, atMs: number, stamp: () => Stamp): Told<Stamp> | null {
      const change = state.observe(up, atMs, stamp);
      if (!change) return null;
      if (!change.value) {
        lost = change.seen;
        return { stamp: change.seen, body: { type: 'connection-lost' } };
      }
      const since = lost;
      lost = null;
      if (!since) return null;
      return {
        stamp: change.seen,
        body: { type: 'connection-restored', lostMs: change.seen.atMs - since.atMs },
      };
    },
  };
}
