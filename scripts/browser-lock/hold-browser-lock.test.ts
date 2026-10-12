// @vitest-environment node
import { mkdtemp, readFile, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { holdBrowserLock } from './hold-browser-lock';
import { parseLockRecord } from './parse-lock-record';

const ROOT = path.resolve(import.meta.dirname, '../..');
let folder: string;
let lock: string;
const releases: (() => void)[] = [];

beforeEach(async () => {
  folder = await mkdtemp(path.join(tmpdir(), 'browser-lock-'));
  lock = path.join(folder, 'browser.lock');
  vi.stubEnv('ZEN_RECORDER_BROWSER_LOCK', lock);
  vi.stubEnv('ZEN_RECORDER_BROWSER_LOCK_TOKEN', undefined);
});

afterEach(async () => {
  for (const release of releases.splice(0)) release();
  vi.useRealTimers();
  vi.unstubAllEnvs();
  await rm(folder, { recursive: true, force: true });
});

async function hold(command = 'pnpm test:e2e'): Promise<() => void> {
  const release = await holdBrowserLock(command);
  releases.push(release);
  return release;
}

const holderOf = async (file: string) => parseLockRecord(await readFile(file, 'utf8'));

describe('holdBrowserLock', () => {
  it('takes the lock in the file ZEN_RECORDER_BROWSER_LOCK names, for this process and working copy', async () => {
    const before = Date.now();

    await hold('pnpm bench');

    const holder = await holderOf(lock);
    expect(holder).toMatchObject({ pid: process.pid, command: 'pnpm bench', workingCopy: ROOT });
    expect(holder?.takenAt).toBeGreaterThanOrEqual(before);
  });

  it('hands its token to the processes it starts, so a run under it goes on at once', async () => {
    await hold();

    expect(process.env['ZEN_RECORDER_BROWSER_LOCK_TOKEN']).toBe((await holderOf(lock))?.token);
  });

  it('goes on at once when this process holds it already, and keeps it on that release', async () => {
    await hold();
    const holder = await holderOf(lock);

    const releaseAgain = await hold('a second call');
    releaseAgain();

    expect(await holderOf(lock)).toEqual(holder);
  });

  it('deletes the file on release, once, and takes the token back', async () => {
    const release = await hold();

    release();
    release();

    await expect(stat(lock)).rejects.toThrow(/ENOENT/);
    expect(process.env['ZEN_RECORDER_BROWSER_LOCK_TOKEN']).toBeUndefined();
  });

  it('leaves alone on release a lock another run took over meanwhile', async () => {
    const release = await hold();
    const other = JSON.stringify({ ...(await holderOf(lock)), token: 'theirs', pid: 1 });
    await writeFile(lock, other);

    release();

    expect(await readFile(lock, 'utf8')).toBe(other);
  });

  it('touches the file every 30 s while it holds the lock', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    await hold();
    const old = new Date('2026-01-01T00:00:00Z');
    await utimes(lock, old, old);

    await vi.advanceTimersByTimeAsync(30_000);

    await vi.waitFor(async () => {
      expect((await stat(lock)).mtimeMs).toBeGreaterThan(old.getTime());
    });
  });

  it('does not touch a lock another run took over', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    await hold();
    const other = JSON.stringify({ ...(await holderOf(lock)), token: 'theirs', pid: 1 });
    await writeFile(lock, other);
    const old = new Date('2026-01-01T00:00:00Z');
    await utimes(lock, old, old);

    await vi.advanceTimersByTimeAsync(30_000);
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect((await stat(lock)).mtimeMs).toBe(old.getTime());
  });

  it('releases the lock when the process exits, and stops listening once released', async () => {
    const before = process.listeners('exit');
    const release = await hold();
    const added = process.listeners('exit').filter((listener) => !before.includes(listener));
    expect(added).toHaveLength(1);

    for (const listener of added) listener(0);

    await expect(stat(lock)).rejects.toThrow(/ENOENT/);
    release();
    expect(process.listeners('exit')).toEqual(before);
  });
});
