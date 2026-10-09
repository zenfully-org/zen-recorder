/**
 * Whether a recording's page will deliver nothing more although nothing ended it: it is still
 * `recording`, no connected tab claims it, and its last chunk (or its start, without one) is older
 * than a page that lives takes to deliver one, chunks it sends again included. Its tab died and
 * marking it interrupted failed, or the background never learned of it. What is stored can be
 * saved: the background never saves a recording a page may still deliver.
 */
import type { RecordingMeta } from '@/lib/types';

/** A living page sends a chunk every few seconds, and one that was not acked again 11 s later. */
export const ABANDONED_AFTER_MS = 60_000;

export function isAbandonedRecording(
  meta: RecordingMeta,
  context: { claimedIds: ReadonlySet<string>; now: number; staleMs?: number },
): boolean {
  if (meta.status !== 'recording' || context.claimedIds.has(meta.id)) return false;
  const quietMs = context.now - (meta.lastChunkAt ?? meta.startedAt);
  return quietMs >= (context.staleMs ?? ABANDONED_AFTER_MS);
}
