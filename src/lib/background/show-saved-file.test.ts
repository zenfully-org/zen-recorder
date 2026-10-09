import { describe, expect, it } from 'vitest';
import { saveBlobToDownloads } from '@/lib/finalize/save-blob-to-downloads';
import { createFakeDownloads, type FakeDownloads } from '@/test/fakes/create-fake-downloads';
import { showSavedFile } from './show-saved-file';

const save = (downloads: FakeDownloads, relativePath: string) =>
  saveBlobToDownloads(new Blob(['webm']), relativePath, { ...downloads.deps, pollMs: 5 });

describe('showSavedFile', () => {
  it('reveals the file in its folder', async () => {
    const downloads = createFakeDownloads();
    const { filename } = await save(downloads, 'zen-recorder/standup.webm');
    await showSavedFile(filename, downloads.showDeps);
    expect(downloads.revealed).toEqual(['/downloads/zen-recorder/standup.webm']);
  });

  it('reveals the file of that exact path, not one whose path differs only in case', async () => {
    // Firefox compares the paths without regard to case; on Linux they are two different files.
    const downloads = createFakeDownloads();
    await save(downloads, 'zen-recorder/standup.webm');
    const { filename } = await save(downloads, 'zen-recorder/Standup.webm');
    await showSavedFile(filename, downloads.showDeps);
    expect(downloads.revealed).toEqual(['/downloads/zen-recorder/Standup.webm']);
  });

  it('opens the download folder and says why when the browser no longer lists the file', async () => {
    const downloads = createFakeDownloads();
    const { filename } = await save(downloads, 'zen-recorder/standup.webm');
    downloads.restart();
    // The next session's first download takes the id the recording was saved under.
    await save(downloads, 'invoice.pdf');
    await expect(showSavedFile(filename, downloads.showDeps)).rejects.toThrow(
      'Firefox no longer lists it among its downloads (it forgets them when it restarts or ' +
        'when the list is cleared), so the download folder opened instead. It was saved as ' +
        '/downloads/zen-recorder/standup.webm',
    );
    expect(downloads.revealed).toEqual(['/downloads']);
  });
});
