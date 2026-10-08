import { describe, expect, it } from 'vitest';
import { createFakeOpfsStorage } from '@/test/fakes/create-fake-opfs-storage';
import { createOpfsScratchFile } from './create-opfs-scratch-file';

async function write(
  writable: FileSystemWritableFileStream,
  chunks: ({ type: 'write'; data: Uint8Array; position?: number } | Uint8Array)[],
) {
  const writer = (writable as unknown as WritableStream).getWriter();
  for (const chunk of chunks) await writer.write(chunk);
  writer.releaseLock();
}

describe('createOpfsScratchFile', () => {
  it('creates the file, accepts positioned writes and returns the file-backed blob', async () => {
    const storage = createFakeOpfsStorage();
    const scratch = await createOpfsScratchFile({ storage, name: 'r1.webm' });
    await write(scratch.writable, [
      { type: 'write', data: new Uint8Array([1, 2, 3, 4]), position: 0 },
      { type: 'write', data: new Uint8Array([9]), position: 1 },
      new Uint8Array([7, 8]),
    ]);
    const file = await scratch.file();
    expect(file.name).toBe('r1.webm');
    expect(Array.from(new Uint8Array(await file.arrayBuffer()))).toEqual([1, 9, 7, 8]);
    // Reading twice does not close twice.
    expect((await scratch.file()).size).toBe(4);
  });

  it('tolerates a writable that the muxer already closed', async () => {
    const storage = createFakeOpfsStorage();
    const scratch = await createOpfsScratchFile({ storage, name: 'r2.webm' });
    storage.failClose = true;
    expect((await scratch.file()).size).toBe(0);
  });

  it('discard removes the file and is safe to call twice', async () => {
    const storage = createFakeOpfsStorage();
    const scratch = await createOpfsScratchFile({ storage, name: 'r3.webm' });
    await scratch.discard();
    await scratch.discard();
    expect(storage.removed).toEqual(['r3.webm']);
    expect(storage.files.has('r3.webm')).toBe(false);
  });

  it('truncates a leftover file with the same name', async () => {
    const storage = createFakeOpfsStorage();
    storage.files.set('r4.webm', new Uint8Array([1, 2, 3]));
    const scratch = await createOpfsScratchFile({ storage, name: 'r4.webm' });
    expect((await scratch.file()).size).toBe(0);
  });
});
