/**
 * The recordings meeting pages announce (`recordingStarted`), stored as their metadata.
 *
 * A page announces a recording once, and again only when a bridge configures it, which a stopped
 * recording never is. So an announcement the store refuses (a full disk, a closing database) is
 * kept here, and the recording's next chunk or its end stores it: without its metadata a
 * recording is never listed or saved, and its chunks are deleted a day later.
 */
import type { ChunkStore } from '@/lib/storage/open-chunk-store';
import type { RecordingMeta, RecordingStartedInfo } from '@/lib/types';

export interface RecordingStarts {
  /** Stores the recording `info` announces, or keeps it when the store refuses. Never rejects. */
  announce(info: RecordingStartedInfo): Promise<void>;
  /**
   * The stored recording `id`. A start the store refused is stored first, quietly: a chunk comes
   * every few seconds and Diagnostics keep only the last 400 lines. Undefined while it refuses.
   */
  stored(id: string): Promise<RecordingMeta | undefined>;
  /** True while the store refuses the start of recording `id`. */
  pending(id: string): boolean;
}

export interface RecordingStartsDeps {
  store: ChunkStore;
  /** Called once a recording's metadata has been stored (e.g. to check disk headroom). */
  onRecordingStarted?: (info: RecordingStartedInfo) => void;
  warn: (message: string, detail?: unknown) => void;
}

export function createRecordingStarts(deps: RecordingStartsDeps): RecordingStarts {
  const refused = new Map<string, RecordingStartedInfo>();

  const store = async (info: RecordingStartedInfo): Promise<RecordingMeta> => {
    // Chunks stored before the recording count: a chunk is sent again every second until it is
    // acked, while an announcement lost on a Port that was down comes again only when a bridge
    // configures the page, and a refused one is stored with a later message of its recording.
    const early = await deps.store.getChunks(info.recordingId);
    const meta: RecordingMeta = {
      id: info.recordingId,
      provider: info.provider,
      meetingCode: info.meetingCode,
      title: info.title,
      startedAt: info.startedAt,
      mimeType: info.mimeType,
      ...(info.micLabel ? { micLabel: info.micLabel } : {}),
      ...(info.hasVideo ? { hasVideo: true } : {}),
      status: 'recording',
      chunkCount: (early.at(-1)?.seq ?? -1) + 1,
      byteSize: early.reduce((total, stored) => total + stored.byteLength, 0),
    };
    await deps.store.putRecording(meta);
    refused.delete(info.recordingId);
    deps.onRecordingStarted?.(info);
    return meta;
  };

  return {
    async announce(info) {
      try {
        const existing = await deps.store.getRecording(info.recordingId);
        if (!existing) {
          await store(info);
          return;
        }
        // Re-announced after a bridge/background reload: keep the running totals.
        if (existing.status !== 'recording') {
          deps.warn(`recording ${info.recordingId} re-announced but already ${existing.status}`);
        }
      } catch (error) {
        refused.set(info.recordingId, info);
        deps.warn(
          `could not store the start of recording ${info.recordingId}, so it is not listed yet; trying again with its next chunk and its end:`,
          error,
        );
      }
    },
    async stored(id) {
      const meta = await deps.store.getRecording(id);
      const info = refused.get(id);
      return meta ?? (info ? await store(info).catch(() => undefined) : undefined);
    },
    pending: (id) => refused.has(id),
  };
}
