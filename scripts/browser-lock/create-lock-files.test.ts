// @vitest-environment node
import { mkdtemp, readdir, readFile, rm, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createLockFiles } from './create-lock-files';

let folder: string;
let lock: string;

beforeEach(async () => {
  folder = await mkdtemp(path.join(tmpdir(), 'browser-lock-'));
  lock = path.join(folder, 'browser.lock');
});

afterEach(async () => {
  await rm(folder, { recursive: true, force: true });
});

describe('createLockFiles', () => {
  it('creates the file once, with all its text, and leaves no draft beside it', async () => {
    const files = createLockFiles();

    expect(await files.create(lock, '{"token":"a"}')).toBe(true);
    expect(await files.create(lock, '{"token":"b"}')).toBe(false);

    expect(await readFile(lock, 'utf8')).toBe('{"token":"a"}');
    expect(await readdir(folder)).toEqual(['browser.lock']);
  });

  it('reads the text and when the file was last touched, and null once it is gone', async () => {
    const files = createLockFiles();
    await files.create(lock, 'text');
    const touched = new Date('2026-10-12T10:00:00Z');
    await utimes(lock, touched, touched);

    expect(await files.read(lock)).toEqual({ text: 'text', touchedAtMs: touched.getTime() });
    await files.remove(lock);
    expect(await files.read(lock)).toBeNull();
  });

  it('moves a file that exists, and says when there was none to move', async () => {
    const files = createLockFiles();
    await files.create(lock, 'text');
    const aside = `${lock}.aside`;

    expect(await files.move(lock, aside)).toBe(true);
    expect(await files.move(lock, aside)).toBe(false);

    expect(await readdir(folder)).toEqual(['browser.lock.aside']);
  });

  it('removes a file that is gone already without a word', async () => {
    await expect(createLockFiles().remove(lock)).resolves.toBeUndefined();
  });

  it('fails when the folder of the lock does not exist', async () => {
    await expect(
      createLockFiles().create(path.join(folder, 'missing', 'x.lock'), 't'),
    ).rejects.toThrow(/ENOENT/);
  });
});
