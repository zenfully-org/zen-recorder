import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type DownloadProgress,
  type DownloadsDeps,
  saveBlobToDownloads,
} from './save-blob-to-downloads';

const inProgress: DownloadProgress = { state: 'in_progress', filename: '/dl/zen-recorder/a.webm' };
const complete: DownloadProgress = { state: 'complete', filename: '/dl/zen-recorder/a.webm' };

/**
 * The downloads API as the module sees it: `search` answers from the download's state at that
 * moment, one entry of `answers` per call, the last one repeating.
 */
function setup(answers: DownloadProgress[][]) {
  let calls = 0;
  const deps = {
    download: vi.fn(async () => 7),
    search: vi.fn(
      async (_query: { id: number }) => answers[Math.min(calls++, answers.length - 1)] ?? [],
    ),
    createObjectURL: vi.fn(() => 'blob:x'),
    revokeObjectURL: vi.fn(),
    setTimeout: (handler: () => void, ms: number) => setTimeout(handler, ms),
    pollMs: 250,
    timeoutMs: 1000,
  } satisfies DownloadsDeps;
  return { deps };
}

const blob = new Blob(['audio']);

describe('saveBlobToDownloads', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('downloads with uniquify, polls until complete, resolves the final filename and revokes', async () => {
    const { deps } = setup([[inProgress], [inProgress], [complete]]);
    const promise = saveBlobToDownloads(blob, 'zen-recorder/a.webm', deps);
    await vi.advanceTimersByTimeAsync(0);
    expect(deps.download).toHaveBeenCalledWith({
      url: 'blob:x',
      filename: 'zen-recorder/a.webm',
      conflictAction: 'uniquify',
      saveAs: false,
    });
    expect(deps.search).toHaveBeenLastCalledWith({ id: 7 });
    await vi.advanceTimersByTimeAsync(250);
    expect(deps.revokeObjectURL).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(250);
    await expect(promise).resolves.toEqual({ downloadId: 7, filename: '/dl/zen-recorder/a.webm' });
    expect(deps.search).toHaveBeenCalledTimes(3);
    expect(deps.revokeObjectURL).toHaveBeenCalledWith('blob:x');
  });

  it('notices a download that completes right after the first search answered', async () => {
    // Firefox subscribes an onChanged listener in its parent process asynchronously, so the event
    // of a small file that completes right after `search` answered `in_progress` can reach nobody.
    // No event fires here at all: the next poll has to see it.
    const { deps } = setup([[inProgress], [complete]]);
    const promise = saveBlobToDownloads(blob, 'zen-recorder/a.webm', deps);
    const outcome = expect(promise).resolves;
    await vi.advanceTimersByTimeAsync(250);
    await outcome.toEqual({ downloadId: 7, filename: '/dl/zen-recorder/a.webm' });
  });

  it('returns without waiting when the download is already complete', async () => {
    const { deps } = setup([[{ state: 'complete', filename: '/dl/done.webm' }]]);
    await expect(saveBlobToDownloads(blob, 'done.webm', deps)).resolves.toEqual({
      downloadId: 7,
      filename: '/dl/done.webm',
    });
    expect(deps.search).toHaveBeenCalledTimes(1);
  });

  it.each([
    {
      name: 'already interrupted, with a reason',
      answers: [[{ state: 'interrupted', filename: '', error: 'FILE_FAILED' }]],
      settlesAtMs: 0,
      message: 'download interrupted: FILE_FAILED',
    },
    {
      name: 'interrupted later, without a reason',
      answers: [[inProgress], [{ state: 'interrupted', filename: '' }]],
      settlesAtMs: 250,
      message: 'download interrupted: unknown',
    },
    {
      name: 'erased from the download list',
      answers: [[inProgress], []],
      settlesAtMs: 250,
      message: 'download 7 is no longer in the download list',
    },
    {
      name: 'still in progress at the timeout',
      answers: [[inProgress]],
      settlesAtMs: 1000,
      message: 'download timed out',
    },
  ] satisfies {
    name: string;
    answers: DownloadProgress[][];
    settlesAtMs: number;
    message: string;
  }[])('rejects when $name', async ({ answers, settlesAtMs, message }) => {
    const { deps } = setup(answers);
    let settled = false;
    const promise = saveBlobToDownloads(blob, 'x.webm', deps).finally(() => {
      settled = true;
    });
    const outcome = expect(promise).rejects.toThrow(message);
    if (settlesAtMs > 0) {
      await vi.advanceTimersByTimeAsync(settlesAtMs - 1);
      expect(settled).toBe(false);
    }
    await vi.advanceTimersByTimeAsync(1);
    await outcome;
    expect(deps.revokeObjectURL).toHaveBeenCalledWith('blob:x');
  });

  it('rejects and revokes when search fails', async () => {
    const { deps } = setup([[inProgress]]);
    deps.search.mockRejectedValueOnce(new Error('search failed'));
    await expect(saveBlobToDownloads(blob, 'x.webm', deps)).rejects.toThrow('search failed');
    expect(deps.revokeObjectURL).toHaveBeenCalledWith('blob:x');
  });

  it('polls every 250 ms for 10 minutes by default', async () => {
    const { deps } = setup([[inProgress]]);
    const { pollMs: _poll, timeoutMs: _timeout, ...defaults } = deps;
    const promise = saveBlobToDownloads(blob, 'x.webm', defaults);
    const outcome = expect(promise).rejects.toThrow('download timed out');
    await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
    await outcome;
    expect(deps.search).toHaveBeenCalledTimes(10 * 60 * 4 + 1);
  });
});
