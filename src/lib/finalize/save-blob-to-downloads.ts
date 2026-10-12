/**
 * Saves a Blob through the downloads API and resolves once the file is complete on disk. The object
 * URL must be created in an extension page (Firefox rejects content-script blob URLs, bug 1696174)
 * and revoked only after the download ends.
 *
 * Completion is read by polling `downloads.search`, not from `downloads.onChanged`: Firefox
 * subscribes a listener in its parent process asynchronously, so a small file can complete before
 * a listener hears it, and the save then waited for an event that had already fired. `search`
 * answers from the download's live state, so a poll cannot miss the end.
 *
 * A background can stop while it saves (an update, a reload), after Firefox completed the download
 * but before the caller stored the result, and the next background saves the file again: Firefox
 * gives the copy a numbered name, one the next recording may have been meant to use. So a save can
 * `remember` its download's address before the download starts, and a later attempt at the same
 * file passes it back as `resumeFrom`. Firefox lists a download under its address for the whole
 * browser session, extension reloads included (one download list in the parent process for every
 * extension, `ext-downloads.js`), and its blob address names that download alone. A download it
 * still lists as complete is the file: the save takes it and downloads nothing. One still running
 * is waited for. One interrupted, or no longer listed (a desktop Firefox forgets finished
 * downloads when it restarts, and when its history is cleared), is saved again: a copy is better
 * than no file.
 */
import type { Browser } from 'wxt/browser';

export interface SaveResult {
  downloadId: number;
  filename: string;
}

/** What a save reads of a `downloads.DownloadItem`. */
export type DownloadProgress = Pick<
  Browser.downloads.DownloadItem,
  'id' | 'state' | 'filename' | 'error'
>;

export interface DownloadsDeps {
  download: (options: Browser.downloads.DownloadOptions) => Promise<number>;
  /** `downloads.search`: by id, or by address (compared whole, without regard to case). */
  search: (query: { id: number } | { url: string }) => Promise<DownloadProgress[]>;
  createObjectURL: (blob: Blob) => string;
  revokeObjectURL: (url: string) => void;
  /** Cancels a download given up on, so it does not land on disk later. */
  cancel: (downloadId: number) => Promise<void>;
  setTimeout: (handler: () => void, ms: number) => unknown;
  /** How often the download's state is read (default 250 ms). */
  pollMs?: number;
  /** Gives up on a download still in progress after this long (default 10 min). */
  timeoutMs?: number;
  /** The address an earlier attempt at this file remembered, when it never heard how it ended. */
  resumeFrom?: string | undefined;
  /** Stores the address of the download before it starts; the save fails when it cannot. */
  remember?: (url: string) => Promise<void>;
}

/** How long a save waits for a download, and how often it looks. */
interface Timing {
  pollMs: number;
  timeoutMs: number;
}

/**
 * Download `downloadId` once it ended (complete or interrupted), or undefined once Firefox no
 * longer lists it: only an erase removes it, and nothing reports on it again. One still running
 * at the timeout is cancelled, and the save fails.
 */
async function waitForEnd(
  downloadId: number,
  deps: DownloadsDeps,
  timing: Timing,
): Promise<DownloadProgress | undefined> {
  for (let waitedMs = 0; ; waitedMs += timing.pollMs) {
    const [item] = await deps.search({ id: downloadId });
    if (item?.state !== 'in_progress') return item;
    if (waitedMs >= timing.timeoutMs) {
      // One that ended meanwhile cannot be cancelled: it is on disk, and the caller hears it failed.
      await deps.cancel(downloadId).catch(() => undefined);
      throw new Error('download timed out');
    }
    await new Promise<void>((resolve) => {
      deps.setTimeout(resolve, timing.pollMs);
    });
  }
}

/** The file an earlier attempt's download saved, once Firefox ended it; undefined for none. */
async function earlierFile(
  url: string,
  deps: DownloadsDeps,
  timing: Timing,
): Promise<SaveResult | undefined> {
  const [listed] = await deps.search({ url });
  if (!listed) return undefined;
  const end = await waitForEnd(listed.id, deps, timing);
  return end?.state === 'complete' ? { downloadId: listed.id, filename: end.filename } : undefined;
}

export async function saveBlobToDownloads(
  blob: Blob,
  relativePath: string,
  deps: DownloadsDeps,
): Promise<SaveResult> {
  const timing = { pollMs: deps.pollMs ?? 250, timeoutMs: deps.timeoutMs ?? 10 * 60 * 1000 };
  if (deps.resumeFrom !== undefined) {
    const saved = await earlierFile(deps.resumeFrom, deps, timing);
    if (saved) return saved;
  }
  const url = deps.createObjectURL(blob);
  try {
    await deps.remember?.(url);
    const downloadId = await deps.download({
      url,
      filename: relativePath,
      conflictAction: 'uniquify',
      saveAs: false,
    });
    const end = await waitForEnd(downloadId, deps, timing);
    if (!end) throw new Error(`download ${downloadId} is no longer in the download list`);
    if (end.state === 'interrupted') {
      throw new Error(`download interrupted: ${end.error ?? 'unknown'}`);
    }
    return { downloadId, filename: end.filename };
  } finally {
    deps.revokeObjectURL(url);
  }
}
