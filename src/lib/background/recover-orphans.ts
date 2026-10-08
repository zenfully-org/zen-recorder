/**
 * Finalizes recordings left behind by a crash, tab close or extension restart. Recordings that a
 * connected tab still claims are skipped. Never rejects: a recording that cannot be recovered is
 * logged and the pass goes on with the next one.
 */
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

const DEFAULT_STALE_MS = 60_000;

export async function recoverOrphans(deps: RecoverOrphansDeps): Promise<string[]> {
  const claimed = new Set(deps.claimedIds());
  const now = deps.now ?? (() => Date.now());
  const staleMs = deps.staleMs ?? DEFAULT_STALE_MS;
  const recordings = await deps.store.listRecordings().catch((error: unknown) => {
    deps.warn('could not list the recordings to recover:', error);
    return [];
  });
  const recovered: string[] = [];
  for (const meta of recordings) {
    if (claimed.has(meta.id)) continue;
    if (meta.status === 'recording' && now() - (meta.lastChunkAt ?? meta.startedAt) < staleMs) {
      continue;
    }
    try {
      if (meta.status === 'recording' || meta.status === 'interrupted') {
        await deps.store.updateRecording(meta.id, {
          status: 'interrupted',
          endedAt: meta.endedAt ?? now(),
        });
        await deps.finalize(meta.id, { recovered: true });
        recovered.push(meta.id);
      } else if (meta.status === 'ended' || meta.status === 'finalizing') {
        await deps.finalize(meta.id, { recovered: false });
        recovered.push(meta.id);
      }
    } catch (error) {
      // Its chunks stay in the store; the next background start tries again.
      deps.warn(`could not recover ${meta.id}:`, error);
    }
  }
  return recovered;
}
