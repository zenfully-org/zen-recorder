/**
 * Where the browser lock lives: `ZEN_RECORDER_BROWSER_LOCK` when it names a file, else one file per
 * machine in the system's temporary folder. One per machine, because what the runs must not share
 * is the machine's: Firefox processes started by tests disturb each other's timing, and every
 * run serves the fake meeting pages on the same port. Every working copy on the machine finds the
 * same file without a setting, and a CI runner, which runs one job, never waits.
 */
import { tmpdir } from 'node:os';
import path from 'node:path';

export function browserLockFile(env: NodeJS.ProcessEnv): string {
  return env['ZEN_RECORDER_BROWSER_LOCK'] || path.join(tmpdir(), 'zen-recorder-browser.lock');
}
