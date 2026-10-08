/**
 * Test builds only: wraps the chunk store so the e2e run can make a store call fail, the way a
 * full disk (`QuotaExceededError`) or a closed database does, and check that the recording
 * survives it: one `putChunk`, every `putChunk` until restored (a disk that stays full), one
 * `putRecording` (a recording's start), or the update that marks a recording interrupted when its
 * tab is gone or a recovery pass takes it. It can also hold a `putChunk`, the way a busy store
 * does, so a tab can die while a chunk it delivered is still being stored.
 */
import type { ChunkStore } from '@/lib/storage/open-chunk-store';

export interface FaultInjectingStore {
  store: ChunkStore;
  /** The next `putChunk` rejects and stores nothing; the ones after it work again. */
  failNextPutChunk(): void;
  /** Every `putChunk` rejects and stores nothing until `restorePutChunks`. */
  failPutChunks(): void;
  /** Ends `failPutChunks`; returns how many `putChunk` calls it failed. */
  restorePutChunks(): number;
  /** The next `putRecording` rejects and stores nothing; the ones after it work again. */
  failNextPutRecording(): void;
  /**
   * The next `updateRecording` that marks a recording `interrupted` rejects and changes nothing.
   * Each call arms one more; other updates are not affected.
   */
  failNextInterruption(): void;
  /** The next `putChunk` waits until `releasePutChunks`; the ones after it are not held. */
  holdNextPutChunk(): void;
  /** How many `putChunk` calls are waiting for `releasePutChunks`. */
  heldPutChunks(): number;
  /** Lets the held calls go on, or disarms a hold no call has used yet; returns how many it let go. */
  releasePutChunks(): number;
}

const injected = () => new DOMException('injected by the e2e run', 'QuotaExceededError');

export function createFaultInjectingStore(store: ChunkStore): FaultInjectingStore {
  let failNext = false;
  let failAll = false;
  let failedAll = 0;
  let failNextRecording = false;
  let interruptionsToFail = 0;
  let holdNext = false;
  const held: (() => void)[] = [];
  return {
    store: {
      ...store,
      async putChunk(chunk) {
        if (holdNext) {
          holdNext = false;
          await new Promise<void>((resolve) => held.push(resolve));
        }
        if (failAll) {
          failedAll += 1;
          throw injected();
        }
        if (!failNext) return store.putChunk(chunk);
        failNext = false;
        throw injected();
      },
      async putRecording(meta) {
        if (!failNextRecording) return store.putRecording(meta);
        failNextRecording = false;
        throw injected();
      },
      async updateRecording(id, patch) {
        if (patch.status !== 'interrupted' || interruptionsToFail === 0) {
          return store.updateRecording(id, patch);
        }
        interruptionsToFail -= 1;
        throw injected();
      },
    },
    failNextPutChunk() {
      failNext = true;
    },
    failPutChunks() {
      failAll = true;
    },
    restorePutChunks() {
      const failed = failedAll;
      failAll = false;
      failedAll = 0;
      return failed;
    },
    failNextPutRecording() {
      failNextRecording = true;
    },
    failNextInterruption() {
      interruptionsToFail += 1;
    },
    holdNextPutChunk() {
      holdNext = true;
    },
    heldPutChunks: () => held.length,
    releasePutChunks() {
      holdNext = false;
      const resumed = held.splice(0);
      for (const resume of resumed) resume();
      return resumed.length;
    },
  };
}
