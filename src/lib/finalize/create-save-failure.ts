/**
 * Test builds only: makes the next save fail, as a download Firefox interrupts does (a full disk,
 * a folder that went away), so the e2e run can check what a failed save leaves and what a retry
 * from the popup saves.
 */
import type { SaveBlob } from '@/lib/finalize/create-save-queue';

export interface SaveFailure {
  save: SaveBlob;
  /** The next save rejects before it starts a download; the ones after it run. */
  failNextSave(): void;
}

export function createSaveFailure(save: SaveBlob): SaveFailure {
  let failNext = false;
  return {
    async save(blob, relativePath) {
      if (!failNext) return save(blob, relativePath);
      failNext = false;
      throw new Error('download interrupted: FILE_FAILED');
    },
    failNextSave() {
      failNext = true;
    },
  };
}
