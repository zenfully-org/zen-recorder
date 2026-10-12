/**
 * The browser lock's file operations on the real file system, the same on Linux, macOS and
 * Windows. A lock is created complete or not at all: the record is written to a draft of its own,
 * which is then hard-linked to the lock's name. A link fails when the name exists, so one run gets
 * it, and a run that reads the lock never sees it half written (as `writeFile` with the `wx` flag
 * would let it: the file exists, empty, before its text is in).
 */
import { randomUUID } from 'node:crypto';
import { link, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import type { LockFiles } from './take-browser-lock';

export function createLockFiles(): LockFiles {
  return {
    async create(file, text) {
      const draft = `${file}.${randomUUID()}.draft`;
      await writeFile(draft, text, { flag: 'wx' });
      try {
        await link(draft, file);
        return true;
      } catch (error) {
        if (codeOf(error) === 'EEXIST') return false;
        throw error;
      } finally {
        await rm(draft, { force: true });
      }
    },
    async read(file) {
      try {
        const [text, info] = await Promise.all([readFile(file, 'utf8'), stat(file)]);
        return { text, touchedAtMs: info.mtimeMs };
      } catch (error) {
        if (codeOf(error) === 'ENOENT') return null;
        throw error;
      }
    },
    async move(from, to) {
      try {
        await rename(from, to);
        return true;
      } catch (error) {
        if (codeOf(error) === 'ENOENT') return false;
        throw error;
      }
    },
    async remove(file) {
      await rm(file, { force: true });
    },
  };
}

const codeOf = (error: unknown): unknown =>
  error instanceof Error && 'code' in error ? error.code : undefined;
