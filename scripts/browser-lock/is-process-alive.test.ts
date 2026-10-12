// @vitest-environment node
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { PROCESS_BUDGET_MS } from '../process-budget';
import { isProcessAlive } from './is-process-alive';

// Starts one Node process, to have the pid of a process that has ended.
describe('isProcessAlive', { timeout: PROCESS_BUDGET_MS }, () => {
  it('finds this process', () => {
    expect(isProcessAlive(process.pid)).toBe(true);
  });

  it('finds no process that has ended', () => {
    const ended = spawnSync(process.execPath, ['-e', '']).pid;

    expect(isProcessAlive(ended)).toBe(false);
  });

  it.skipIf(process.platform === 'win32')(
    'finds a process of another user, which it may not signal',
    () => {
      expect(isProcessAlive(1)).toBe(true);
    },
  );
});
