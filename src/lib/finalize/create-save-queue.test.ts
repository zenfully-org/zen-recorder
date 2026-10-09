import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeDownloads } from '@/test/fakes/create-fake-downloads';
import { createSaveQueue } from './create-save-queue';
import { type SaveResult, saveBlobToDownloads } from './save-blob-to-downloads';

/** A save the test settles by hand; `paths` lists the saves that have started. */
function manualSaves() {
  const started: {
    path: string;
    resolve: (result: SaveResult) => void;
    reject: (error: Error) => void;
  }[] = [];
  const save = (_blob: Blob, path: string) =>
    new Promise<SaveResult>((resolve, reject) => {
      started.push({ path, resolve, reject });
    });
  const settle = (index: number) => {
    const call = started[index];
    if (!call) throw new Error(`save ${index} has not started`);
    return call;
  };
  return { save, settle, paths: () => started.map((call) => call.path) };
}

const blob = new Blob(['audio']);

describe('createSaveQueue', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('keeps both files when two saves ask for the same new name at once', async () => {
    // Firefox uniquifies only a name that is already on disk: two downloads of a new name at the
    // same moment get the same target, and the one that fails removes the other's file.
    const downloads = createFakeDownloads();
    const save = createSaveQueue((data, path) => saveBlobToDownloads(data, path, downloads.deps));
    const first = new Blob(['first recording']);
    const second = new Blob(['second recording']);
    const both = Promise.all([
      save(first, 'zen-recorder/call.webm'),
      save(second, 'zen-recorder/call.webm'),
    ]);
    const outcome = expect(both).resolves.toEqual([
      { downloadId: 1, filename: '/downloads/zen-recorder/call.webm' },
      { downloadId: 2, filename: '/downloads/zen-recorder/call(1).webm' },
    ]);
    await vi.advanceTimersByTimeAsync(1_000);
    await outcome;
    expect(downloads.files.get('/downloads/zen-recorder/call.webm')).toBe(first);
    expect(downloads.files.get('/downloads/zen-recorder/call(1).webm')).toBe(second);
    expect(downloads.liveUrls()).toEqual([]);
  });

  it('runs one save at a time, in the order they were asked for', async () => {
    const { save, settle, paths } = manualSaves();
    const queued = createSaveQueue(save);
    const results = [queued(blob, 'a.webm'), queued(blob, 'a.md'), queued(blob, 'b.webm')];
    await vi.advanceTimersByTimeAsync(0);
    expect(paths()).toEqual(['a.webm']);
    settle(0).resolve({ downloadId: 1, filename: '/dl/a.webm' });
    await expect(results[0]).resolves.toEqual({ downloadId: 1, filename: '/dl/a.webm' });
    expect(paths()).toEqual(['a.webm', 'a.md']);
    settle(1).resolve({ downloadId: 2, filename: '/dl/a.md' });
    await expect(results[1]).resolves.toEqual({ downloadId: 2, filename: '/dl/a.md' });
    expect(paths()).toEqual(['a.webm', 'a.md', 'b.webm']);
  });

  it('starts the next save as soon as one fails, and reports the failure to its caller', async () => {
    const { save, settle, paths } = manualSaves();
    const queued = createSaveQueue(save);
    const failing = queued(blob, 'a.webm');
    const next = queued(blob, 'b.webm');
    await vi.advanceTimersByTimeAsync(0);
    settle(0).reject(new Error('download timed out'));
    await expect(failing).rejects.toThrow('download timed out');
    expect(paths()).toEqual(['a.webm', 'b.webm']);
    settle(1).resolve({ downloadId: 2, filename: '/dl/b.webm' });
    await expect(next).resolves.toEqual({ downloadId: 2, filename: '/dl/b.webm' });
  });

  it('starts a save at once when nothing is waiting', async () => {
    const { save, settle, paths } = manualSaves();
    const queued = createSaveQueue(save);
    const first = queued(blob, 'a.webm');
    await vi.advanceTimersByTimeAsync(0);
    settle(0).resolve({ downloadId: 1, filename: '/dl/a.webm' });
    await first;
    const later = queued(blob, 'b.webm');
    await vi.advanceTimersByTimeAsync(0);
    expect(paths()).toEqual(['a.webm', 'b.webm']);
    settle(1).resolve({ downloadId: 2, filename: '/dl/b.webm' });
    await expect(later).resolves.toEqual({ downloadId: 2, filename: '/dl/b.webm' });
  });

  // The notes file, small, gives up early: a download that hangs must not hold the next recording.
  it('hands a save its own options, such as how long it may take', async () => {
    const save = vi.fn(async (_blob: Blob, path: string) => ({ downloadId: 1, filename: path }));
    const queued = createSaveQueue(save);
    await queued(blob, 'a.md', { timeoutMs: 30_000 });
    await queued(blob, 'a.webm');
    expect(save.mock.calls.map((call) => call.slice(1))).toEqual([
      ['a.md', { timeoutMs: 30_000 }],
      ['a.webm', undefined],
    ]);
  });
});
