/**
 * Holds the machine's browser lock for the rest of this process, so that one run at a time starts
 * Firefox: the end-to-end run, the soak, the benchmarks and the store screenshots call it before
 * they take anything a second run would share (the fixture server's port, the downloads folder),
 * and the harness's `launch` calls it again for any other script that starts a browser. A run that
 * finds it held waits and says for whom (`takeBrowserLock`).
 *
 * The lock is released when the process exits, or by the function this returns. While it holds
 * the lock, the process touches the file every 30 s, so that a run that waits can tell it from a
 * lock left behind. It hands its token to the processes it starts (`ZEN_RECORDER_BROWSER_LOCK_TOKEN`),
 * which go on without waiting: `pnpm browser-lock pnpm test:e2e` holds it once. A `flock` around a
 * run locks another file and is harmless.
 */
import { randomUUID } from 'node:crypto';
import { readFileSync, unlinkSync } from 'node:fs';
import { readFile, utimes } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { browserLockFile } from './browser-lock-file';
import { createLockFiles } from './create-lock-files';
import { isProcessAlive } from './is-process-alive';
import { parseLockRecord } from './parse-lock-record';
import { takeBrowserLock } from './take-browser-lock';

const TOKEN_ENV = 'ZEN_RECORDER_BROWSER_LOCK_TOKEN';
const HEARTBEAT_MS = 30_000;
const ROOT = path.resolve(import.meta.dirname, '../..');

/** `command` names the run in the lines of a run that waits for it. */
export async function holdBrowserLock(command = describeThisRun()): Promise<() => void> {
  const file = browserLockFile(process.env);
  const token = randomUUID();
  const outcome = await takeBrowserLock(
    {
      files: createLockFiles(),
      isAlive: isProcessAlive,
      now: Date.now,
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      log: (line) => console.log(line),
      home: homedir(),
    },
    {
      file,
      record: { token, pid: process.pid, command, workingCopy: ROOT, takenAt: Date.now() },
      inheritedToken: process.env[TOKEN_ENV],
    },
  );
  if (outcome === 'inherited') return () => {};
  process.env[TOKEN_ENV] = token;
  const heartbeat = setInterval(() => void touchWhileHeld(file, token), HEARTBEAT_MS);
  // The heartbeat must not keep a run alive that has finished.
  heartbeat.unref();
  const release = (): void => {
    clearInterval(heartbeat);
    process.off('exit', release);
    if (process.env[TOKEN_ENV] === token) delete process.env[TOKEN_ENV];
    // Synchronous: it runs in the process's `exit` event, where nothing asynchronous runs.
    if (heldBy(readTextSync(file), token)) unlinkSync(file);
  };
  process.on('exit', release);
  return release;
}

/** `pnpm test:e2e` for a package script, else the script's path. */
function describeThisRun(): string {
  const script = process.env['npm_lifecycle_event'];
  if (script) return `pnpm ${script}`;
  return `tsx ${path.relative(ROOT, process.argv[1] ?? '')}`;
}

const heldBy = (text: string | null, token: string): boolean =>
  text !== null && parseLockRecord(text)?.token === token;

function readTextSync(file: string): string | null {
  try {
    return readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

/** A lock another run took over (this one was frozen for ten minutes) is that run's to touch. */
async function touchWhileHeld(file: string, token: string): Promise<void> {
  try {
    if (!heldBy(await readFile(file, 'utf8'), token)) return;
    const now = new Date();
    await utimes(file, now, now);
  } catch (error) {
    console.log(`browser lock: could not touch ${file}: ${String(error)}`);
  }
}
