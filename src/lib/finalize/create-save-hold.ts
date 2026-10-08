/**
 * Test builds only: lets the e2e run hold the next save for as long as it needs, the way a long
 * video's remux and download hold its finalize (15 s for an hour on an idle machine, 42 s under
 * load), and check that the tab's next recording is stored meanwhile.
 */
import type { SaveBlob } from '@/lib/finalize/create-save-queue';

export interface SaveHold {
  save: SaveBlob;
  /** The next save waits until `release` is called; the ones after it are not held. */
  holdNextSave(): void;
  /** Lets the held save go on, or disarms a hold no save has used yet. */
  release(): void;
}

export function createSaveHold(save: SaveBlob): SaveHold {
  let holdNext = false;
  const held: (() => void)[] = [];
  return {
    async save(blob, relativePath) {
      if (holdNext) {
        holdNext = false;
        await new Promise<void>((resolve) => held.push(resolve));
      }
      return save(blob, relativePath);
    },
    holdNextSave() {
      holdNext = true;
    },
    release() {
      holdNext = false;
      for (const resume of held.splice(0)) resume();
    },
  };
}
