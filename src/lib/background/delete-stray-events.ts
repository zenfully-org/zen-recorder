/**
 * Deletes stray meeting events: events stored for a recording that was never stored itself. The
 * background stores events that come before their recording's announcement, which the page sends
 * again when its bridge reconnects; if it never comes, nothing else would delete them, and without
 * a recording they never become notes. Events that came within a day, or of a recording a
 * connected tab still claims, are kept. Never rejects: what it cannot delete is logged.
 */
import type { ChunkStore } from '@/lib/storage/open-chunk-store';
import type { EventStore } from '@/lib/storage/open-event-store';

const HOUR_MS = 3_600_000;
const KEEP_MS = 24 * HOUR_MS;

export async function deleteStrayEvents(deps: {
  events: EventStore;
  store: ChunkStore;
  claimedIds: () => Iterable<string>;
  warn: (message: string, detail?: unknown) => void;
  now?: () => number;
}): Promise<string[]> {
  const { events, store, warn } = deps;
  const claimed = new Set(deps.claimedIds());
  const now = (deps.now ?? Date.now)();
  let ids: string[] = [];
  try {
    ids = await events.listRecordingIds();
  } catch (error) {
    warn('could not list the stored meeting events:', error);
  }
  const deleted: string[] = [];
  for (const id of ids.filter((candidate) => !claimed.has(candidate))) {
    try {
      const rows = await events.getEvents(id);
      const age = now - Math.max(...rows.map((row) => row.receivedAt));
      if ((await store.getRecording(id)) !== undefined || age < KEEP_MS) continue;
      await events.deleteEvents(id);
      deleted.push(id);
      warn(
        `deleted ${rows.length} meeting event(s) of ${id}: no recording was stored for them, and none came for ${Math.floor(age / HOUR_MS)} h`,
      );
    } catch (error) {
      warn(`could not delete the stray meeting events of ${id}:`, error);
    }
  }
  return deleted;
}
