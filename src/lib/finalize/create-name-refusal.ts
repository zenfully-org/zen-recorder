/**
 * Test builds only: makes Firefox refuse the next save's file name, as it refuses a name with a
 * character the sanitizer let through, so the e2e run can check that the recording is saved under
 * the fallback name, once.
 */
import type { SaveBlob } from '@/lib/finalize/create-save-queue';

export interface NameRefusal {
  save: SaveBlob;
  /** The next save's name gets a zero-width joiner, which Firefox's downloads API refuses. */
  refuseNextName(): void;
}

export function createNameRefusal(save: SaveBlob): NameRefusal {
  let refuseNext = false;
  return {
    save(blob, relativePath) {
      if (!refuseNext) return save(blob, relativePath);
      refuseNext = false;
      return save(
        blob,
        relativePath.replace(/[^/]*$/, (leaf) => `\u200D${leaf}`),
      );
    },
    refuseNextName() {
      refuseNext = true;
    },
  };
}
