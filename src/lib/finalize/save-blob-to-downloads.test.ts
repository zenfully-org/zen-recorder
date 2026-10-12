import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type DownloadProgress,
  type DownloadsDeps,
  saveBlobToDownloads,
} from './save-blob-to-downloads';

const inProgress: DownloadProgress = {
  id: 7,
  state: 'in_progress',
  filename: '/dl/zen-recorder/a.webm',
};
const complete: DownloadProgress = {
  id: 7,
  state: 'complete',
  filename: '/dl/zen-recorder/a.webm',
};

/**
 * The downloads API as the module sees it: `search` answers from the download's state at that
 * moment, one entry of `answers` per call, the last one repeating.
 */
function setup(answers: DownloadProgress[][]) {
  let calls = 0;
  const deps = {
    download: vi.fn(async () => 7),
    search: vi.fn(
      async (_query: { id: number } | { url: string }) =>
        answers[Math.min(calls++, answers.length - 1)] ?? [],
    ),
    createObjectURL: vi.fn(() => 'blob:x'),
    revokeObjectURL: vi.fn(),
    cancel: vi.fn(async (_id: number) => undefined),
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
    const { deps } = setup([[{ id: 7, state: 'complete', filename: '/dl/done.webm' }]]);
    await expect(saveBlobToDownloads(blob, 'done.webm', deps)).resolves.toEqual({
      downloadId: 7,
      filename: '/dl/done.webm',
    });
    expect(deps.search).toHaveBeenCalledTimes(1);
  });

  it.each([
    {
      name: 'already interrupted, with a reason',
      answers: [[{ id: 7, state: 'interrupted', filename: '', error: 'FILE_FAILED' }]],
      settlesAtMs: 0,
      message: 'download interrupted: FILE_FAILED',
    },
    {
      name: 'interrupted later, without a reason',
      answers: [[inProgress], [{ id: 7, state: 'interrupted', filename: '' }]],
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

  // Given up on, it would still land on disk later, beside the file saved after it.
  it('cancels a download it gives up on, even when the cancel comes too late', async () => {
    const { deps } = setup([[inProgress]]);
    deps.cancel.mockRejectedValueOnce(new Error('Download 7 cannot be canceled'));
    const outcome = expect(saveBlobToDownloads(blob, 'x.md', deps)).rejects.toThrow(
      'download timed out',
    );
    await vi.advanceTimersByTimeAsync(1000);
    await outcome;
    expect(deps.cancel).toHaveBeenCalledWith(7);
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

/**
 * An earlier attempt at the same file, by a background that stopped before it heard how the
 * download ended: Firefox lists it under its address as download 3 in this browser session.
 */
const earlier = (state: DownloadProgress['state']): DownloadProgress => ({
  id: 3,
  state,
  filename: '/dl/zen-recorder/a.md',
});

describe('saveBlobToDownloads after a background that stopped while it saved', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('takes the file of the earlier download Firefox completed, and downloads nothing', async () => {
    const { deps } = setup([[earlier('complete')]]);
    const saved = saveBlobToDownloads(blob, 'zen-recorder/a.md', {
      ...deps,
      resumeFrom: 'blob:earlier',
    });
    await expect(saved).resolves.toEqual({ downloadId: 3, filename: '/dl/zen-recorder/a.md' });
    expect(deps.search.mock.calls).toEqual([[{ url: 'blob:earlier' }], [{ id: 3 }]]);
    expect(deps.createObjectURL).not.toHaveBeenCalled();
    expect(deps.download).not.toHaveBeenCalled();
  });

  it('waits for the earlier download Firefox is still saving', async () => {
    const { deps } = setup([
      [earlier('in_progress')],
      [earlier('in_progress')],
      [earlier('complete')],
    ]);
    const saved = saveBlobToDownloads(blob, 'zen-recorder/a.md', {
      ...deps,
      resumeFrom: 'blob:earlier',
    });
    const outcome = expect(saved).resolves.toEqual({
      downloadId: 3,
      filename: '/dl/zen-recorder/a.md',
    });
    await vi.advanceTimersByTimeAsync(250);
    await outcome;
    expect(deps.download).not.toHaveBeenCalled();
  });

  // Firefox lists no finished download of an earlier browser session: a copy, never no file.
  it.each([
    { name: 'Firefox no longer lists it', answers: [[], [complete]] },
    {
      name: 'it was interrupted',
      answers: [[earlier('interrupted')], [earlier('interrupted')], [complete]],
    },
    { name: 'it was erased while it ran', answers: [[earlier('in_progress')], [], [complete]] },
  ] satisfies { name: string; answers: DownloadProgress[][] }[])(
    'downloads the file again when $name',
    async ({ answers }) => {
      const { deps } = setup(answers);
      const saved = saveBlobToDownloads(blob, 'zen-recorder/a.webm', {
        ...deps,
        resumeFrom: 'blob:earlier',
      });
      await expect(saved).resolves.toEqual({ downloadId: 7, filename: '/dl/zen-recorder/a.webm' });
      expect(deps.download).toHaveBeenCalledTimes(1);
      expect(deps.search).toHaveBeenLastCalledWith({ id: 7 });
    },
  );

  it("stores the new download's address before the download starts", async () => {
    const { deps } = setup([[complete]]);
    const order: string[] = [];
    deps.download.mockImplementationOnce(async () => {
      order.push('download');
      return 7;
    });
    const remember = vi.fn(async (url: string) => void order.push(`remember ${url}`));
    await saveBlobToDownloads(blob, 'zen-recorder/a.webm', { ...deps, remember });
    expect(order).toEqual(['remember blob:x', 'download']);
  });

  // A file whose download the next attempt could not find again is saved twice.
  it('downloads nothing when the address cannot be stored', async () => {
    const { deps } = setup([[complete]]);
    const remember = vi.fn(async () => {
      throw new Error('QuotaExceededError');
    });
    await expect(
      saveBlobToDownloads(blob, 'zen-recorder/a.webm', { ...deps, remember }),
    ).rejects.toThrow('QuotaExceededError');
    expect(deps.download).not.toHaveBeenCalled();
    expect(deps.revokeObjectURL).toHaveBeenCalledWith('blob:x');
  });
});
