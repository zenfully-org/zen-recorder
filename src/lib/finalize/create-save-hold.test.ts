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
    expect(save).toHaveBeenCalledWith(blob, 'a.webm');
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
});
