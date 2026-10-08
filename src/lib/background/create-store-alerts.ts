/**
 * Decides when a meeting tab hears that the background cannot store what it records.
 *
 * A chunk or an end the store refused (a full disk, a database the browser closed) is not acked,
 * so the page keeps it and sends it again every few seconds. Diagnostics get a warning each time,
 * but the person recording sees a REC pill that looks fine. So the tab that sent it is told, once:
 * again only once everything of that tab that failed has been stored, so a disk that stays full
 * does not toast at every send.
 */
import { z } from 'zod';
import type { BackgroundToTab, TabToBackground } from '@/lib/types';

export interface StoreAlerts {
  /**
   * A message of tab `tabId` failed in the store. Returns the `error` message to post to that tab,
   * or null when the tab was told already and nothing of it that failed has been stored since.
   */
  failed(tabId: number, message: TabToBackground, error: unknown): BackgroundToTab | null;
  /** A message of tab `tabId` was handled: its recording no longer waits for the store. */
  stored(tabId: number, message: TabToBackground): void;
}

const namedError = z.object({ name: z.string() });

/**
 * The messages the page sends again until they are stored. An announcement is not one of them:
 * the background keeps one the store refused, and handling it says nothing about storing.
 */
const recordingOf = (message: TabToBackground): string | null => {
  if (message.type === 'chunk') return message.chunk.recordingId;
  if (message.type === 'recordingEnded') return message.info.recordingId;
  return null;
};

/** What went wrong, in words the person recording can act on. */
const describe = (error: unknown): string => {
  const parsed = namedError.safeParse(error);
  const name = parsed.success ? parsed.data.name : String(error);
  // Firefox's IndexedDB reports a full disk as a quota error (SQLite's SQLITE_FULL, and a Blob
  // file that cannot be written).
  return name === 'QuotaExceededError'
    ? 'the disk is full, so this recording cannot be saved for now. Free some space and keep this tab open: it holds what it records until there is room.'
    : `the browser's storage refuses this recording (${name}), so it cannot be saved for now. Keep this tab open: it holds what it records until storing works again.`;
};

export function createStoreAlerts(): StoreAlerts {
  /** Per tab, the recordings of which a chunk or the end failed and has not been stored since. */
  const unstored = new Map<number, Set<string>>();

  return {
    failed(tabId, message, error) {
      const recordingId = recordingOf(message);
      if (recordingId === null) return null;
      const failing = unstored.get(tabId) ?? new Set<string>();
      const told = failing.size > 0;
      failing.add(recordingId);
      unstored.set(tabId, failing);
      return told ? null : { type: 'error', recordingId, message: describe(error) };
    },
    stored(tabId, message) {
      const recordingId = recordingOf(message);
      const failing = unstored.get(tabId);
      if (recordingId === null || !failing) return;
      failing.delete(recordingId);
      if (failing.size === 0) unstored.delete(tabId);
    },
  };
}
