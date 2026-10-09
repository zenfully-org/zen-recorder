/**
 * Shows a saved recording's file in its folder (the popup's Show file).
 *
 * The file is looked up by its absolute path each time, never by the id `downloads.download` gave
 * it. Firefox numbers the downloads of the extension API anew in every browser session, and a
 * desktop Firefox keeps no finished download in that list across a restart (Gecko's
 * `ext-downloads.js` `DownloadMap`, `DownloadIntegration.shouldPersistDownload`; bug 1247794). A
 * stored id therefore names whatever the next session downloaded under that number, or nothing.
 *
 * When Firefox no longer lists the file (after a restart, or once the person cleared the list),
 * nothing can reveal it: the download folder opens instead, and the error says why and where the
 * file was saved, for the popup to show.
 */
import type { Browser } from 'wxt/browser';

/** What showing a file reads of a `downloads.DownloadItem`. */
type ListedDownload = Pick<Browser.downloads.DownloadItem, 'id' | 'filename'>;

export interface ShowSavedFileDeps {
  /** `downloads.search`: Firefox compares `filename` without regard to case. */
  search: (query: { filename: string }) => Promise<ListedDownload[]>;
  /** `downloads.show`: reveals a listed download's file in its folder. */
  show: (downloadId: number) => Promise<unknown>;
  /** `downloads.showDefaultFolder`: opens the download folder. */
  showDefaultFolder: () => void;
}

export async function showSavedFile(filename: string, deps: ShowSavedFileDeps): Promise<void> {
  const listed = await deps.search({ filename });
  // On a case-sensitive disk a path that differs only in case is another file.
  const own = listed.find((item) => item.filename === filename);
  if (own) {
    await deps.show(own.id);
    return;
  }
  deps.showDefaultFolder();
  throw new Error(
    'Firefox no longer lists it among its downloads (it forgets them when it restarts or when ' +
      `the list is cleared), so the download folder opened instead. It was saved as ${filename}`,
  );
}
