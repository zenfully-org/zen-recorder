// @vitest-environment node
import { buildCiReport } from './build-ci-report';
import type { RunInfo, StepFailure, StepRecord } from './types';

const RUN: RunInfo = {
  workflow: 'CI',
  id: 37842080740,
  attempt: 1,
  url: 'https://github.com/owner/repo/actions/runs/37842080740',
  sha: 'abc123',
  ref: 'refs/pull/61/merge',
  event: 'pull_request',
};

const record = (step: string, exitCode: number, seconds: number): StepRecord => ({
  step,
  command: `pnpm ${step}`,
  exitCode,
  startedAt: 1_000_000,
  endedAt: 1_000_000 + seconds * 1000,
});

const TYPE_ERROR: StepFailure = {
  tool: 'tsc',
  message: 'Type mismatch.',
  file: 'src/lib/a.ts',
  line: 3,
  column: 9,
  rule: 'TS2322',
  test: null,
  scenario: null,
  provider: null,
};

describe('buildCiReport', () => {
  it('lists the steps in run order with how each ended, and the failed one with its errors', () => {
    const failuresOf = vi.fn(() => [TYPE_ERROR]);

    const report = buildCiReport({
      job: 'gate',
      jobName: 'Gate',
      jobStatus: 'failure',
      run: RUN,
      context: [
        { id: 'checkout', outcome: 'success' },
        { id: 'lint', outcome: 'success' },
        { id: 'types', outcome: 'failure' },
        { id: 'unit', outcome: 'skipped' },
      ],
      records: [record('lint', 0, 12.34), record('types', 2, 20)],
      failuresOf,
      artifacts: [],
    });

    expect(report).toEqual({
      version: 1,
      job: 'gate',
      jobName: 'Gate',
      status: 'failed',
      run: RUN,
      failedStep: 'types',
      steps: [
        {
          id: 'checkout',
          command: null,
          status: 'passed',
          durationSeconds: null,
          exitCode: null,
          log: null,
          failures: [],
        },
        {
          id: 'lint',
          command: 'pnpm lint',
          status: 'passed',
          durationSeconds: 12.3,
          exitCode: 0,
          log: null,
          failures: [],
        },
        {
          id: 'types',
          command: 'pnpm types',
          status: 'failed',
          durationSeconds: 20,
          exitCode: 2,
          log: 'logs/types.log',
          failures: [TYPE_ERROR],
        },
        {
          id: 'unit',
          command: null,
          status: 'skipped',
          durationSeconds: null,
          exitCode: null,
          log: null,
          failures: [],
        },
      ],
      artifacts: [],
    });
    expect(failuresOf).toHaveBeenCalledExactlyOnceWith('types');
  });

  it('adds the steps the workflow gave no id after the others', () => {
    const report = buildCiReport({
      job: 'e2e-meet',
      jobName: 'E2E (meet)',
      jobStatus: 'success',
      run: RUN,
      context: [{ id: 'install', outcome: 'success' }],
      records: [record('install', 0, 5), record('__run_2', 0, 1)],
      failuresOf: () => [],
      artifacts: ['e2e-meet'],
    });

    expect(report.steps.map((step) => [step.id, step.status])).toEqual([
      ['install', 'passed'],
      ['__run_2', 'passed'],
    ]);
    expect(report.status).toBe('passed');
    expect(report.failedStep).toBeNull();
    expect(report.artifacts).toEqual(['e2e-meet']);
  });

  it('tells a cancelled job and a cancelled step apart from a failure', () => {
    const report = buildCiReport({
      job: 'gate',
      jobName: 'Gate',
      jobStatus: 'cancelled',
      run: RUN,
      context: [{ id: 'unit', outcome: 'cancelled' }],
      records: [],
      failuresOf: () => [],
      artifacts: [],
    });

    expect(report.status).toBe('cancelled');
    expect(report.steps[0]?.status).toBe('cancelled');
    expect(report.failedStep).toBeNull();
  });
});
