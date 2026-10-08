/**
 * Deletes stray chunks: chunks stored for a recording whose metadata never was. The background
 * stores a chunk that arrives before its recording's announcement, because the page sends that
 * announcement again when its bridge reconnects; if it never comes, nothing else would ever delete
 * them. Without metadata they cannot become a file (no type, title or start time) and the popup
 * does not list them, so they only take disk space. Chunks that arrived within `staleMs`, or that
 * a connected tab still names as its recording, are kept: their announcement may still come.
 * Never rejects: a recording whose chunks cannot be deleted is logged and the pass goes on.
 */
import type { ChunkStore } from '@/lib/storage/open-chunk-store';

export interface DeleteStrayChunksDeps {
  store: ChunkStore;
  claimedIds: () => Iterable<string>;
  /** Where a deletion, or a failure to delete, is reported (the diagnostics log). */
  warn: (message: string, detail?: unknown) => void;
  now?: () => number;
  /** Stray chunks are kept while the newest of them arrived more recently than this. */
  staleMs?: number;
}

const HOUR_MS = 60 * 60 * 1000;
const DEFAULT_STALE_MS = 24 * HOUR_MS;

export async function deleteStrayChunks(deps: DeleteStrayChunksDeps): Promise<string[]> {
  const claimed = new Set(deps.claimedIds());
  const now = deps.now ?? (() => Date.now());
  const staleMs = deps.staleMs ?? DEFAULT_STALE_MS;
  const ids = await deps.store.listRecordingIdsWithChunks().catch((error: unknown) => {
    deps.warn('could not list the stored chunks:', error);
    return [];
  });
  const deleted: string[] = [];
  for (const id of ids) {
    if (claimed.has(id)) continue;
    try {
      if (await deps.store.getRecording(id)) continue;
      const chunks = await deps.store.getChunks(id);
      const newest = chunks.reduce((latest, chunk) => Math.max(latest, chunk.receivedAt), 0);
      // Gone meanwhile (the recording was removed from the popup), or still arriving.
      if (chunks.length === 0 || now() - newest < staleMs) continue;
      await deps.store.deleteChunks(id);
      deleted.push(id);
      const hours = Math.floor((now() - newest) / HOUR_MS);
      deps.warn(
        `deleted ${chunks.length} ${chunks.length === 1 ? 'chunk' : 'chunks'} of ${id}: no recording was stored for them, and none arrived for ${hours} h`,
      );
    } catch (error) {
      deps.warn(`could not delete the stray chunks of ${id}:`, error);
    }
  }
  return deleted;
}
