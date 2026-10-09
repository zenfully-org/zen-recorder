import { describe, expect, it, vi } from 'vitest';
import { createSaveFailure } from './create-save-failure';

const blob = new Blob(['audio']);

describe('createSaveFailure', () => {
  it('passes saves through until it is armed', async () => {
    const save = vi.fn(async (_blob: Blob, path: string) => ({ downloadId: 1, filename: path }));
    const failure = createSaveFailure(save);
    await expect(failure.save(blob, 'zen-recorder/a.webm')).resolves.toEqual({
      downloadId: 1,
      filename: 'zen-recorder/a.webm',
    });
    expect(save).toHaveBeenCalledOnce();
  });

  it('fails the next save as an interrupted download, without starting it, and only that one', async () => {
    const save = vi.fn(async (_blob: Blob, path: string) => ({ downloadId: 2, filename: path }));
    const failure = createSaveFailure(save);
    failure.failNextSave();
    await expect(failure.save(blob, 'zen-recorder/a.webm')).rejects.toThrow(
      'download interrupted: FILE_FAILED',
    );
    expect(save).not.toHaveBeenCalled();
    await expect(failure.save(blob, 'zen-recorder/a.webm')).resolves.toMatchObject({
      downloadId: 2,
    });
  });

  // A notes file gives up sooner than a recording: the save beneath must hear it.
  it("passes a save's own options on", async () => {
    const save = vi.fn(async (_blob: Blob, path: string) => ({ downloadId: 1, filename: path }));
    await createSaveFailure(save).save(blob, 'a.md', { timeoutMs: 30_000 });
    expect(save).toHaveBeenCalledWith(blob, 'a.md', { timeoutMs: 30_000 });
  });
});
