import { describe, expect, it } from 'vitest';
import { describeLockNotice, type LockNotice } from './describe-lock-notice';
import type { LockRecord } from './parse-lock-record';

const HOME = '/home/<you>';
const holder: LockRecord = {
  token: 'b7f3',
  pid: 4242,
  command: 'pnpm test:e2e',
  workingCopy: '/home/<you>/work/zen-recorder',
  takenAt: 1_000_000,
};

describe('describeLockNotice', () => {
  it.each<[string, LockNotice, string]>([
    [
      'whom a run waits for, where it runs and for how long it has held the lock',
      { kind: 'waiting', holder, file: '/tmp/zen-recorder-browser.lock', nowMs: 1_192_000 },
      'browser lock: waiting for pnpm test:e2e (pid 4242, in ~/work/zen-recorder), which has held it for 3 min 12 s; one run at a time starts Firefox on this machine (/tmp/zen-recorder-browser.lock)',
    ],
    [
      'the minute reminder, short',
      { kind: 'still-waiting', holder, waitedMs: 120_000 },
      'browser lock: still waiting for pnpm test:e2e (pid 4242), 2 min so far',
    ],
    [
      'how long the run waited',
      { kind: 'taken', waitedMs: 45_400 },
      'browser lock: taken after 45 s of waiting',
    ],
    [
      'a long wait in hours',
      { kind: 'taken', waitedMs: (2 * 60 + 5) * 60_000 + 30_000 },
      'browser lock: taken after 2 h 5 min of waiting',
    ],
    [
      'a wait of whole hours',
      { kind: 'taken', waitedMs: 2 * 3_600_000 },
      'browser lock: taken after 2 h of waiting',
    ],
    [
      'a holder whose process is gone',
      { kind: 'taken-over', holder, why: 'ended', silentMs: 600_000 },
      'browser lock: pnpm test:e2e (pid 4242, in ~/work/zen-recorder) ended without releasing it; taking it over',
    ],
    [
      'a holder that stopped touching the file',
      { kind: 'taken-over', holder, why: 'silent', silentMs: 600_000 },
      'browser lock: pnpm test:e2e (pid 4242, in ~/work/zen-recorder) has not touched it for 10 min (its pid may belong to another program now); taking it over',
    ],
  ])('says %s', (_, notice, line) => {
    expect(describeLockNotice(notice, HOME)).toBe(line);
  });

  it.each<[string, string, string]>([
    ['outside the home folder in full', '/srv/zen-recorder', '/srv/zen-recorder'],
    ['the home folder itself as ~', HOME, '~'],
    ['a sibling of the home folder in full', '/home/<you>-else/zen', '/home/<you>-else/zen'],
    ['a Windows working copy under the home folder', 'C:\\Users\\<you>\\zen', '~\\zen'],
  ])('names a working copy %s', (_, workingCopy, shown) => {
    const home = workingCopy.startsWith('C:') ? 'C:\\Users\\<you>' : HOME;
    const notice: LockNotice = {
      kind: 'waiting',
      holder: { ...holder, workingCopy },
      file: 'f',
      nowMs: 1_000_000,
    };
    expect(describeLockNotice(notice, home)).toContain(
      `(pid 4242, in ${shown}), which has held it for 0 s`,
    );
  });
});
