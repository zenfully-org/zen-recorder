// @vitest-environment node
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PROCESS_BUDGET_MS } from './process-budget';

const ROOT = path.resolve(import.meta.dirname, '..');
const TSX = path.join(ROOT, 'node_modules/tsx/dist/cli.mjs');
const CLI = path.join(ROOT, 'scripts/browser-lock.ts');
let folder: string;
let lock: string;
/** Prints whether the lock file names the token the command was handed, then exits with 7. */
let checkHeld: string;

beforeEach(async () => {
  folder = await mkdtemp(path.join(tmpdir(), 'browser-lock-cli-'));
  lock = path.join(folder, 'browser.lock');
  checkHeld = path.join(folder, 'check-held.cjs');
  await writeFile(
    checkHeld,
    `const fs = require('node:fs');
const record = JSON.parse(fs.readFileSync(process.env.ZEN_RECORDER_BROWSER_LOCK, 'utf8'));
console.log(record.token === process.env.ZEN_RECORDER_BROWSER_LOCK_TOKEN ? 'held for me' : 'not mine');
process.exit(7);
`,
  );
});

afterEach(async () => {
  await rm(folder, { recursive: true, force: true });
});

/** `pnpm browser-lock …args`, with the lock in this test's folder. */
function browserLock(...args: string[]) {
  return spawnSync(process.execPath, [TSX, CLI, ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    // A run that waits for its own lock would wait for ever: fail instead.
    timeout: 15_000,
    env: {
      ...process.env,
      ZEN_RECORDER_BROWSER_LOCK: lock,
      ZEN_RECORDER_BROWSER_LOCK_TOKEN: '',
    },
  });
}

// Starts Node processes through tsx: one per call, two for the nested call.
describe('pnpm browser-lock', { timeout: PROCESS_BUDGET_MS }, () => {
  it('runs the command under the lock, exits with its code and releases the lock', () => {
    const run = browserLock(process.execPath, checkHeld);

    expect(run.stdout).toContain('held for me');
    expect(run.status).toBe(7);
    expect(existsSync(lock)).toBe(false);
  });

  it('runs a run that takes the lock itself under it, without waiting for its own lock', () => {
    const run = browserLock(process.execPath, TSX, CLI, process.execPath, checkHeld);

    expect(run.stdout).toContain('held for me');
    expect(run.stdout).not.toContain('waiting');
    expect(run.status).toBe(7);
  });

  it('says how to use it when no command is given', () => {
    const run = browserLock();

    expect(run.stderr).toContain('usage: pnpm browser-lock <command> [arguments…]');
    expect(run.status).toBe(2);
    expect(existsSync(lock)).toBe(false);
  });
});
