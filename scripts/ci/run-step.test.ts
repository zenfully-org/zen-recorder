// @vitest-environment node
/**
 * `scripts/ci/run-step.ts` run as CI runs it, the shell of a `run` step: plain Node.js (no tsx),
 * a script file, the step's id in GITHUB_ACTION, and a folder for its records.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PROCESS_BUDGET_MS } from '../process-budget';

const RUN_STEP = path.resolve(import.meta.dirname, 'run-step.ts');

let work = '';

beforeEach(() => {
  work = mkdtempSync(path.join(tmpdir(), 'zen-recorder-run-step-'));
});

afterEach(() => {
  rmSync(work, { recursive: true, force: true });
});

function runStep(script: string, step = 'lint') {
  const file = path.join(work, 'script');
  writeFileSync(file, script);
  const run = spawnSync(
    process.execPath,
    // Node.js 22.18 and later run TypeScript without the flag; earlier 22.x need it.
    ['--experimental-strip-types', '--disable-warning=ExperimentalWarning', RUN_STEP, file],
    {
      encoding: 'utf8',
      env: { PATH: process.env['PATH'], GITHUB_ACTION: step, CI_REPORT_DIR: work },
    },
  );
  const records = path.join(work, 'steps');
  const read = (name: string) => {
    const full = path.join(records, name);
    return existsSync(full) ? readFileSync(full, 'utf8') : null;
  };
  const json = read(`${step}.json`);
  return {
    status: run.status,
    stdout: run.stdout,
    stderr: run.stderr,
    log: read(`${step}.log`),
    record: json === null ? null : JSON.parse(json),
  };
}

// Each test starts Node on the step runner, which starts bash on the step's script.
describe('run-step.ts', { timeout: PROCESS_BUDGET_MS }, () => {
  it('runs the script, passes its output through and records it for the report', () => {
    const run = runStep('echo out\necho err >&2\n');

    expect(run.status).toBe(0);
    expect(run.stdout).toBe('out\n');
    expect(run.stderr).toBe('err\n');
    expect(run.log).toBe('out\nerr\n');
    expect(run.record).toEqual({
      step: 'lint',
      command: 'echo out\necho err >&2\n',
      exitCode: 0,
      startedAt: expect.any(Number),
      endedAt: expect.any(Number),
    });
    expect(run.record.endedAt).toBeGreaterThanOrEqual(run.record.startedAt);
  });

  it('exits with the script status and stops at the first failing command, as bash -e does', () => {
    const run = runStep('echo before\nfalse\necho after\n');

    expect(run.status).toBe(1);
    expect(run.stdout).toBe('before\n');
    expect(run.record.exitCode).toBe(1);
  });

  it('fails a pipeline whose first command fails, as -o pipefail does', () => {
    const run = runStep('exit 3 | cat\n');

    expect(run.status).toBe(3);
    expect(run.record.exitCode).toBe(3);
  });

  it('names a step without an id the way GitHub does', () => {
    const run = runStep('true\n', '__run_2');

    expect(run.record.step).toBe('__run_2');
  });
});
