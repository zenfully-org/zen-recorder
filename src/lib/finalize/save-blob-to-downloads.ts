/**
 * Saves a Blob through the downloads API and resolves once the file is complete on disk. The object
 * URL must be created in an extension page (Firefox rejects content-script blob URLs, bug 1696174)
 * and revoked only after the download ends.
 *
 * Completion is read by polling `downloads.search`, not from `downloads.onChanged`: Firefox
 * subscribes a listener in its parent process asynchronously, so a small file can complete before
 * a listener hears it, and the save then waited for an event that had already fired. `search`
 * answers from the download's live state, so a poll cannot miss the end.
 */
import type { Browser } from 'wxt/browser';

export interface SaveResult {
  downloadId: number;
  filename: string;
}

/** What a save reads of a `downloads.DownloadItem`. */
export type DownloadProgress = Pick<Browser.downloads.DownloadItem, 'state' | 'filename' | 'error'>;

export interface DownloadsDeps {
  download: (options: Browser.downloads.DownloadOptions) => Promise<number>;
  search: (query: { id: number }) => Promise<DownloadProgress[]>;
  createObjectURL: (blob: Blob) => string;
  revokeObjectURL: (url: string) => void;
  /** Cancels a download given up on, so it does not land on disk later. */
  cancel: (downloadId: number) => Promise<void>;
  setTimeout: (handler: () => void, ms: number) => unknown;
  /** How often the download's state is read (default 250 ms). */
  pollMs?: number;
  /** Gives up on a download still in progress after this long (default 10 min). */
  timeoutMs?: number;
}

export async function saveBlobToDownloads(
  blob: Blob,
  relativePath: string,
  deps: DownloadsDeps,
): Promise<SaveResult> {
  const pollMs = deps.pollMs ?? 250;
  const timeoutMs = deps.timeoutMs ?? 10 * 60 * 1000;
  const url = deps.createObjectURL(blob);
  try {
    const downloadId = await deps.download({
      url,
      filename: relativePath,
      conflictAction: 'uniquify',
      saveAs: false,
    });
    for (let waitedMs = 0; ; waitedMs += pollMs) {
      const [item] = await deps.search({ id: downloadId });
      // Only an erase removes it; nothing will report on it again.
      if (!item) throw new Error(`download ${downloadId} is no longer in the download list`);
      if (item.state === 'complete') return { downloadId, filename: item.filename };
      if (item.state === 'interrupted') {
        throw new Error(`download interrupted: ${item.error ?? 'unknown'}`);
      }
      if (waitedMs >= timeoutMs) {
        // One that ended meanwhile cannot be cancelled: it is on disk, and the caller hears it failed.
        await deps.cancel(downloadId).catch(() => undefined);
        throw new Error('download timed out');
      }
      await new Promise<void>((resolve) => {
        deps.setTimeout(resolve, pollMs);
      });
    }
  } finally {
    deps.revokeObjectURL(url);
  }
}
