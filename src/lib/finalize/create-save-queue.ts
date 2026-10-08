/**
 * Runs the background's saves one at a time, in the order they were asked for: every file the
 * extension writes (the recording, its raw copy, its meeting notes) goes through one queue.
 *
 * Firefox uniquifies a download's name only when that name is already on disk. Two downloads that
 * ask for the same new name at the same moment get the same target, break each other, and the one
 * that fails removes the target, the other's finished file included (Gecko's `ext-downloads.js`,
 * `DownloadPaths.sys.mjs` and `DownloadCore.sys.mjs`). A save therefore starts only once the save
 * before it has settled: complete, its file on disk, or failed.
 *
 * Only the download waits its turn; whatever a caller does before or after its save (the remux,
 * store updates) runs in parallel with other saves. A failed save releases the queue at once, and
 * a save that never ends is bounded by its own timeout.
 */
import type { SaveResult } from '@/lib/finalize/save-blob-to-downloads';

export type SaveBlob = (blob: Blob, relativePath: string) => Promise<SaveResult>;

export function createSaveQueue(save: SaveBlob): SaveBlob {
  let previous: Promise<unknown> = Promise.resolve();
  return (blob, relativePath) => {
    const result = previous.then(() => save(blob, relativePath));
    previous = result.catch(() => undefined);
    return result;
  };
}
