/**
 * Test builds only: lets the e2e run hold the next save for as long as it needs, the way a long
 * video's remux and download hold its finalize (15 s for an hour on an idle machine, 42 s under
 * load), and check that the tab's next recording is stored meanwhile. It can also hold a save's
 * answer once Firefox has saved the file, so the run can stop the background right then: an
 * update or a reload in that moment leaves a file its background never heard of.
 */
import type { SaveBlob } from '@/lib/finalize/create-save-queue';

export interface SaveHold {
  save: SaveBlob;
  /** The next save waits until `release` is called; the ones after it are not held. */
  holdNextSave(): void;
  /**
   * The next save of a file with this extension (`md`) saves it, then waits until `release` is
   * called before it answers; the ones after it are not held.
   */
  holdAfterNextSave(extension: string): void;
  /** Lets the held saves go on, or disarms the holds no save has used yet. */
  release(): void;
}

export function createSaveHold(save: SaveBlob): SaveHold {
  let holdNext = false;
  let holdAfter: string | null = null;
  const held: (() => void)[] = [];
  const wait = () => new Promise<void>((resolve) => held.push(resolve));
  return {
    async save(blob, relativePath, options) {
      if (holdNext) {
        holdNext = false;
        await wait();
      }
      const answerLater = holdAfter !== null && relativePath.endsWith(`.${holdAfter}`);
      if (answerLater) holdAfter = null;
      const saved = await save(blob, relativePath, options);
      if (answerLater) await wait();
      return saved;
    },
    holdNextSave() {
      holdNext = true;
    },
    holdAfterNextSave(extension) {
      holdAfter = extension;
    },
    release() {
      holdNext = false;
      holdAfter = null;
      for (const resume of held.splice(0)) resume();
    },
  };
}
