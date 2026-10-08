import { describe, expect, it } from 'vitest';
import { createFakeDownloads } from '@/test/fakes/create-fake-downloads';
import { createNameRefusal } from './create-name-refusal';
import { saveBlobToDownloads } from './save-blob-to-downloads';

const blob = new Blob(['audio']);

function setup() {
  const downloads = createFakeDownloads({ placeholderMs: 1, writeMs: 2 });
  const refusal = createNameRefusal((data, path) =>
    saveBlobToDownloads(data, path, { ...downloads.deps, pollMs: 1 }),
  );
  return { refusal, files: () => [...downloads.files.keys()] };
}

describe('createNameRefusal', () => {
  it('passes saves through until it is armed', async () => {
    const { refusal, files } = setup();
    await expect(refusal.save(blob, 'zen-recorder/a.webm')).resolves.toMatchObject({
      filename: '/downloads/zen-recorder/a.webm',
    });
    expect(files()).toEqual(['/downloads/zen-recorder/a.webm']);
  });

  it("makes Firefox refuse the next save's name, and only that one", async () => {
    const { refusal, files } = setup();
    refusal.refuseNextName();
    await expect(refusal.save(blob, 'zen-recorder/a.webm')).rejects.toThrow(
      'filename must not contain illegal characters',
    );
    await expect(refusal.save(blob, 'zen-recorder/a.webm')).resolves.toMatchObject({
      filename: '/downloads/zen-recorder/a.webm',
    });
    expect(files()).toEqual(['/downloads/zen-recorder/a.webm']);
  });
});
