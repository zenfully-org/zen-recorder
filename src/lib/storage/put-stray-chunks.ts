/**
 * For the e2e run (test builds only): stores two chunks each of two recordings that have no
 * metadata, as an announcement that never reached storage leaves them. The newest chunk of one
 * arrived 25 h ago, the other's just now, so a background start's stray-chunk pass must delete the
 * first set and keep the second.
 */
import type { ChunkStore } from './open-chunk-store';

const DAY_AND_AN_HOUR_MS = 25 * 60 * 60 * 1000;

export async function putStrayChunks(
  store: Pick<ChunkStore, 'putChunk'>,
  now: () => number = Date.now,
): Promise<{ stale: string; recent: string }> {
  const stale = `stray-${crypto.randomUUID()}`;
  const recent = `stray-${crypto.randomUUID()}`;
  const receivedAt = now();
  for (const [recordingId, age] of [
    [stale, DAY_AND_AN_HOUR_MS],
    [recent, 0],
  ] as const) {
    for (const seq of [0, 1]) {
      const blob = new Blob([new Uint8Array(1024)]);
      await store.putChunk({
        recordingId,
        seq,
        blob,
        byteLength: blob.size,
        receivedAt: receivedAt - age,
      });
    }
  }
  return { stale, recent };
}
