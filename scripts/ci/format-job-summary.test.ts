// @vitest-environment node
import { formatJobSummary } from './format-job-summary';
import type { CiReport, ReportStep, StepFailure } from './types';

const RUN = {
  workflow: 'CI',
  id: 42,
  attempt: 1,
  url: 'https://github.com/owner/repo/actions/runs/42',
  sha: 'abc',
  ref: 'refs/pull/61/merge',
  event: 'pull_request',
};

const failure = (fields: Partial<StepFailure>): StepFailure => ({
  tool: 'tsc',
  message: '',
  file: null,
  line: null,
  column: null,
  rule: null,
  test: null,
  scenario: null,
  provider: null,
  ...fields,
});

const step = (fields: Partial<ReportStep> & Pick<ReportStep, 'id'>): ReportStep => ({
  command: null,
  status: 'passed',
  durationSeconds: null,
  exitCode: null,
  log: null,
  failures: [],
  ...fields,
});

const report = (fields: Partial<CiReport>): CiReport => ({
  version: 1,
  job: 'gate',
  jobName: 'Gate',
  status: 'passed',
  run: RUN,
  failedStep: null,
  steps: [],
  artifacts: [],
  ...fields,
});

describe('formatJobSummary, a failed step', () => {
  it('shows each step, then the failed one: its errors and the command that runs it locally', () => {
    const summary = formatJobSummary(
      report({
        status: 'failed',
        failedStep: 'types',
        steps: [
          step({ id: 'checkout' }),
          step({ id: 'lint', command: 'pnpm check:lint', durationSeconds: 12.3, exitCode: 0 }),
          step({
            id: 'types',
            command: 'pnpm exec tsc --noEmit',
            status: 'failed',
            durationSeconds: 75,
            exitCode: 2,
            log: 'logs/types.log',
            failures: [
              failure({
                message: "Type 'string' is not assignable to type 'number'.\n  Because.",
                file: 'src/lib/a.ts',
                line: 3,
                column: 9,
                rule: 'TS2322',
              }),
              failure({ message: 'Unknown compiler option.', rule: 'TS5023' }),
            ],
          }),
          step({ id: 'unit', status: 'skipped' }),
        ],
      }),
    );

    expect(summary).toBe(
      [
        '## ❌ Gate failed at `types`',
        '',
        '| Step | Result | Time | Command |',
        '| --- | --- | --- | --- |',
        '| `checkout` | ✅ passed |  |  |',
        '| `lint` | ✅ passed | 12 s | <code>pnpm check:lint</code> |',
        '| `types` | ❌ failed | 1 min 15 s | <code>pnpm exec tsc --noEmit</code> |',
        '| `unit` | ⏭️ skipped |  |  |',
        '',
        '### `types` failed: 2 errors',
        '',
        '~~~text',
        'src/lib/a.ts:3:9  TS2322',
        "  Type 'string' is not assignable to type 'number'.",
        '    Because.',
        '',
        'TS5023',
        '  Unknown compiler option.',
        '~~~',
        '',
        'Run it locally:',
        '',
        '~~~bash',
        'pnpm exec tsc --noEmit',
        '~~~',
        '',
        'The step\'s whole log: `gh run view 42 --log-failed`. This report as JSON: `gh run download 42 -n ci-report-gate` (`ci-report.json`, described in CONTRIBUTING.md under "When CI fails").',
        '',
      ].join('\n'),
    );
  });

  it('names the end-to-end scenario, its service and the files the run left', () => {
    const summary = formatJobSummary(
      report({
        job: 'e2e-meet',
        jobName: 'E2E (meet)',
        status: 'failed',
        failedStep: 'e2e',
        artifacts: ['e2e-meet'],
        steps: [
          step({
            id: 'e2e',
            command: 'E2E_PROVIDERS=meet pnpm test:e2e',
            status: 'failed',
            failures: [
              failure({
                tool: 'e2e',
                message: 'timeout waiting for saved file',
                test: 'scenarioFirstSecondsHaveAudio',
                scenario: '35',
                provider: 'meet',
              }),
            ],
          }),
        ],
      }),
    );

    expect(summary).toContain(
      [
        '~~~text',
        'meet: scenario 35 (scenarioFirstSecondsHaveAudio)',
        '  timeout waiting for saved file',
        '~~~',
      ].join('\n'),
    );
    expect(summary).toContain('E2E_PROVIDERS=meet pnpm test:e2e');
    expect(summary).toContain(
      'CONTRIBUTING.md under "When CI fails").\n\nWhat the failed run left: `gh run download 42 -n e2e-meet`.\n',
    );
  });
});

describe('formatJobSummary, the other results and the formatting', () => {
  it('says a job passed, with what each step took', () => {
    const summary = formatJobSummary(
      report({
        steps: [step({ id: 'unit', command: 'pnpm test:coverage', durationSeconds: 0.4 })],
      }),
    );

    expect(summary).toContain('## ✅ Gate passed');
    expect(summary).toContain('| `unit` | ✅ passed | 0 s | <code>pnpm test:coverage</code> |');
    expect(summary).not.toContain('Run it locally');
  });

  it('keeps a table cell to the first line of a command, and escapes what HTML or a table reads', () => {
    const summary = formatJobSummary(
      report({
        steps: [step({ id: 'notices', command: 'grep -c "<a|b>" x &&\n  echo done' })],
      }),
    );

    expect(summary).toContain('<code>grep -c "&lt;a&#124;b&gt;" x &amp;&amp; …</code>');
  });

  it('fences the errors with more tildes than any line of them holds', () => {
    const summary = formatJobSummary(
      report({
        status: 'failed',
        failedStep: 'build',
        steps: [
          step({
            id: 'build',
            command: 'pnpm build',
            status: 'failed',
            failures: [failure({ tool: 'log', message: '~~~ not a fence\n~~~~' })],
          }),
        ],
      }),
    );

    expect(summary).toContain('~~~~~text\n~~~ not a fence\n~~~~\n~~~~~');
  });

  it('shows the first 20 errors of a step and counts the rest', () => {
    const failures = Array.from({ length: 23 }, (_, index) =>
      failure({ message: `error ${index}` }),
    );
    const summary = formatJobSummary(
      report({
        status: 'failed',
        failedStep: 'types',
        steps: [
          step({ id: 'types', command: 'pnpm exec tsc --noEmit', status: 'failed', failures }),
        ],
      }),
    );

    expect(summary).toContain('error 19');
    expect(summary).not.toContain('error 20');
    expect(summary).toContain('3 more in ci-report.json');
  });

  it('points at the log when the failed step is an action or a step the report does not follow', () => {
    const action = formatJobSummary(
      report({
        status: 'failed',
        failedStep: 'checkout',
        steps: [step({ id: 'checkout', status: 'failed' })],
      }),
    );
    const unfollowed = formatJobSummary(report({ status: 'failed', steps: [step({ id: 'a' })] }));

    expect(action).toContain('### `checkout` failed');
    expect(action).toContain('It runs an action, so its output is only in the log');
    expect(unfollowed).toContain('## ❌ Gate failed');
    expect(unfollowed).toContain('A step without an id failed');
  });

  it('says a job was cancelled', () => {
    expect(formatJobSummary(report({ status: 'cancelled' }))).toContain('## ⏹️ Gate was cancelled');
  });
});
