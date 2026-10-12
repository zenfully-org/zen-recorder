import { describe, expect, it, vi } from 'vitest';
import { createSaveHold } from './create-save-hold';

const blob = new Blob(['audio']);
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function setup() {
  const save = vi.fn(async (_blob: Blob, path: string) => ({ downloadId: 1, filename: path }));
  return { save, hold: createSaveHold(save) };
}

describe('createSaveHold', () => {
  it('passes saves straight through while nothing is held', async () => {
    const { save, hold } = setup();
    await expect(hold.save(blob, 'a.webm')).resolves.toEqual({ downloadId: 1, filename: 'a.webm' });
    expect(save).toHaveBeenCalledWith(blob, 'a.webm', undefined);
  });

  it('holds only the next save until it is released, as a long finalize would', async () => {
    const { save, hold } = setup();
    hold.holdNextSave();
    const held = hold.save(blob, 'held.webm');
    await expect(hold.save(blob, 'next.webm')).resolves.toMatchObject({ filename: 'next.webm' });
    await flush();
    expect(save.mock.calls.map(([, path]) => path)).toEqual(['next.webm']);
    hold.release();
    await expect(held).resolves.toMatchObject({ filename: 'held.webm' });
    expect(save.mock.calls.map(([, path]) => path)).toEqual(['next.webm', 'held.webm']);
  });

  it('disarms a hold that no save used yet when released', async () => {
    const { save, hold } = setup();
    hold.holdNextSave();
    hold.release();
    await expect(hold.save(blob, 'a.webm')).resolves.toMatchObject({ filename: 'a.webm' });
    expect(save).toHaveBeenCalledTimes(1);
  });

  // A background that stops right after Firefox completed its download never hears of the file.
  it('lets the next save of a kind of file download it, then holds its answer until released', async () => {
    const { save, hold } = setup();
    hold.holdAfterNextSave('md');
    await expect(hold.save(blob, 'a.webm')).resolves.toMatchObject({ filename: 'a.webm' });
    let answered = false;
    const held = hold.save(blob, 'a.md').then((result) => {
      answered = true;
      return result;
    });
    await expect(hold.save(blob, 'b.md')).resolves.toMatchObject({ filename: 'b.md' });
    await flush();
    expect(save.mock.calls.map(([, path]) => path)).toEqual(['a.webm', 'a.md', 'b.md']);
    expect(answered).toBe(false);
    hold.release();
    await expect(held).resolves.toMatchObject({ filename: 'a.md' });
  });

  it('disarms a hold after a save that no save used yet when released', async () => {
    const { hold } = setup();
    hold.holdAfterNextSave('md');
    hold.release();
    await expect(hold.save(blob, 'a.md')).resolves.toMatchObject({ filename: 'a.md' });
  });

  // A notes file gives up sooner than a recording: the save beneath must hear it.
  it("passes a save's own options on", async () => {
    const save = vi.fn(async (_blob: Blob, path: string) => ({ downloadId: 1, filename: path }));
    await createSaveHold(save).save(blob, 'a.md', { timeoutMs: 30_000 });
    expect(save).toHaveBeenCalledWith(blob, 'a.md', { timeoutMs: 30_000 });
  });
});
