/**
 * Finalizes recordings left behind by a crash, tab close or extension restart. Recordings that a
 * connected tab still claims are skipped. Never rejects: a recording that cannot be recovered is
 * logged and the pass goes on with the next one.
 */
import { ABANDONED_AFTER_MS, isAbandonedRecording } from '@/lib/background/is-abandoned-recording';
import { isRecoveredRecording } from '@/lib/background/is-recovered-recording';
import type { ChunkStore } from '@/lib/storage/open-chunk-store';
import type { RecordingMeta } from '@/lib/types';

export interface RecoverOrphansDeps {
  store: ChunkStore;
  claimedIds: () => Iterable<string>;
  finalize: (
    recordingId: string,
    options: { recovered: boolean },
  ) => Promise<RecordingMeta | undefined>;
  /** Where a recording that could not be recovered is reported (the diagnostics log). */
  warn: (message: string, detail?: unknown) => void;
  now?: () => number;
  /** A recording that received a chunk more recently than this is alive, claimed or not. */
  staleMs?: number;
}

/** What the pass saves when no connected tab claims it; a `recording` one once it is abandoned. */
const ORPHANED: readonly RecordingMeta['status'][] = ['interrupted', 'ended', 'finalizing'];

export async function recoverOrphans(deps: RecoverOrphansDeps): Promise<string[]> {
  const claimedIds = new Set(deps.claimedIds());
  const now = deps.now ?? (() => Date.now());
  const staleMs = deps.staleMs ?? ABANDONED_AFTER_MS;
  const isOrphan = (meta: RecordingMeta): boolean =>
    meta.status === 'recording'
      ? isAbandonedRecording(meta, { claimedIds, now: now(), staleMs })
      : ORPHANED.includes(meta.status) && !claimedIds.has(meta.id);
  const recordings = await deps.store.listRecordings().catch((error: unknown) => {
    deps.warn('could not list the recordings to recover:', error);
    return [];
  });
  const recovered: string[] = [];
  for (const meta of recordings.filter(isOrphan)) {
    try {
      if (meta.status === 'recording' || meta.status === 'interrupted') {
        await deps.store.updateRecording(meta.id, {
          status: 'interrupted',
          endedAt: meta.endedAt ?? now(),
        });
      }
      // A recovered save left `finalizing` says so itself.
      await deps.finalize(meta.id, { recovered: isRecoveredRecording(meta) });
      recovered.push(meta.id);
    } catch (error) {
      // Its chunks stay in the store; the next background start tries again.
      deps.warn(`could not recover ${meta.id}:`, error);
    }
  }
  return recovered;
}
