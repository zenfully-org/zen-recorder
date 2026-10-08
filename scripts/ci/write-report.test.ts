// @vitest-environment node
/**
 * `scripts/ci/write-report.ts` run as the last step of a CI job: the records `run-step.ts` left,
 * GitHub's variables and steps context, and the files it writes.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parseCiReport } from './parse-ci-report';

const REPO = path.resolve(import.meta.dirname, '../..');

let work = '';

beforeEach(() => {
  work = mkdtempSync(path.join(tmpdir(), 'zen-recorder-write-report-'));
  mkdirSync(path.join(work, 'ci-report/steps'), { recursive: true });
});

afterEach(() => {
  rmSync(work, { recursive: true, force: true });
});

function writeRecord(step: string, exitCode: number, log: string): void {
  const steps = path.join(work, 'ci-report/steps');
  const record = { step, command: `pnpm ${step}`, exitCode, startedAt: 1000, endedAt: 3000 };
  writeFileSync(path.join(steps, `${step}.json`), JSON.stringify(record));
  writeFileSync(path.join(steps, `${step}.log`), log);
}

function writeReport(args: string[], jobStatus: string) {
  const summary = path.join(work, 'summary.md');
  const run = spawnSync(
    process.execPath,
    ['--import', 'tsx', 'scripts/ci/write-report.ts', ...args],
    {
      cwd: REPO,
      encoding: 'utf8',
      env: {
        PATH: process.env['PATH'],
        CI_REPORT_DIR: path.join(work, 'ci-report'),
        GITHUB_WORKSPACE: work,
        GITHUB_STEP_SUMMARY: summary,
        GITHUB_WORKFLOW: 'CI',
        GITHUB_RUN_ID: '42',
        GITHUB_RUN_ATTEMPT: '1',
        GITHUB_SERVER_URL: 'https://github.com',
        GITHUB_REPOSITORY: 'owner/repo',
        GITHUB_SHA: 'abc',
        GITHUB_REF: 'refs/pull/61/merge',
        GITHUB_EVENT_NAME: 'pull_request',
        JOB_STATUS: jobStatus,
        STEPS: JSON.stringify({
          checkout: { outcome: 'success', conclusion: 'success', outputs: {} },
          lint: { outcome: 'success', conclusion: 'success', outputs: {} },
          types: {
            outcome: jobStatus === 'success' ? 'success' : 'failure',
            conclusion: 'failure',
            outputs: {},
          },
        }),
      },
    },
  );
  const output = path.join(work, 'ci-report/report');
  return {
    run,
    summary: existsSync(summary) ? readFileSync(summary, 'utf8') : '',
    output,
    report: () =>
      parseCiReport(JSON.parse(readFileSync(path.join(output, 'ci-report.json'), 'utf8'))),
  };
}

describe('write-report.ts', () => {
  it('writes the summary, the JSON with the failed step and its log, and annotates the error', () => {
    writeRecord('lint', 0, 'all good\n');
    writeRecord('types', 2, "src/lib/a.ts(3,9): error TS2322: Type 'x' is not 'y'.\n");

    const { run, summary, output, report } = writeReport(
      ['--job', 'gate', '--name', 'Gate'],
      'failure',
    );

    expect(run.stderr).toBe('');
    expect(run.status).toBe(0);
    expect(run.stdout).toContain(
      "::error file=src/lib/a.ts,line=3,col=9,title=tsc TS2322::Type 'x' is not 'y'.",
    );
    expect(summary).toContain('## ❌ Gate failed at `types`');
    expect(report()).toMatchObject({
      job: 'gate',
      status: 'failed',
      failedStep: 'types',
      run: { id: 42, url: 'https://github.com/owner/repo/actions/runs/42' },
      steps: [
        { id: 'checkout', status: 'passed' },
        { id: 'lint', status: 'passed', durationSeconds: 2, log: null },
        {
          id: 'types',
          status: 'failed',
          log: 'logs/types.log',
          failures: [{ tool: 'tsc', file: 'src/lib/a.ts', rule: 'TS2322' }],
        },
      ],
    });
    expect(readFileSync(path.join(output, 'logs/types.log'), 'utf8')).toContain('TS2322');
    expect(existsSync(path.join(output, 'logs/lint.log'))).toBe(false);
  });

  it('writes a passing job with the artifacts it names', () => {
    writeRecord('lint', 0, '');
    writeRecord('types', 0, '');

    const { run, summary, report } = writeReport(
      ['--job', 'e2e-meet', '--name', 'E2E (meet)', '--artifact', 'e2e-meet'],
      'success',
    );

    expect(run.status).toBe(0);
    expect(summary).toContain('## ✅ E2E (meet) passed');
    expect(report()).toMatchObject({ status: 'passed', failedStep: null, artifacts: ['e2e-meet'] });
  });

  it('says how to call it when an argument is missing', () => {
    const { run } = writeReport(['--job', 'gate'], 'success');

    expect(run.status).toBe(2);
    expect(run.stderr).toContain('Usage: write-report.ts --job <key> --name <check name>');
  });
});
