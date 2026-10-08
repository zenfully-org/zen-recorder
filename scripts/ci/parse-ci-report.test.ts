// @vitest-environment node
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parseCiReport } from './parse-ci-report';
import type { CiReport } from './types';

const REPORT: CiReport = {
  version: 1,
  job: 'e2e-meet',
  jobName: 'E2E (meet)',
  status: 'failed',
  run: {
    workflow: 'CI',
    id: 1,
    attempt: 1,
    url: 'https://github.com/owner/repo/actions/runs/1',
    sha: 'abc',
    ref: 'refs/heads/main',
    event: 'push',
  },
  failedStep: 'e2e',
  steps: [
    {
      id: 'e2e',
      command: 'E2E_PROVIDERS=meet pnpm test:e2e',
      status: 'failed',
      durationSeconds: 512.3,
      exitCode: 1,
      log: 'logs/e2e.log',
      failures: [
        {
          tool: 'e2e',
          message: 'timeout waiting for saved file',
          file: null,
          line: null,
          column: null,
          rule: null,
          test: 'scenarioFirstSecondsHaveAudio',
          scenario: '35',
          provider: 'meet',
        },
      ],
    },
  ],
  artifacts: ['e2e-meet'],
};

describe('parseCiReport', () => {
  it('reads a report of version 1', () => {
    expect(parseCiReport(JSON.parse(JSON.stringify(REPORT)))).toEqual(REPORT);
  });

  it('refuses another version or a missing field, saying what is wrong', () => {
    expect(() => parseCiReport({ ...REPORT, version: 2 })).toThrow(/version/);
    const { failedStep: _, ...withoutFailedStep } = REPORT;
    expect(() => parseCiReport(withoutFailedStep)).toThrow(/failedStep/);
  });

  it('reads the example CONTRIBUTING.md gives under "The report\'s JSON"', () => {
    const contributing = readFileSync(
      path.resolve(import.meta.dirname, '../../CONTRIBUTING.md'),
      'utf8',
    );
    const section = contributing.slice(contributing.indexOf("### The report's JSON"));
    const example = /```json\n([\s\S]*?)\n```/.exec(section)?.[1] ?? '';

    expect(parseCiReport(JSON.parse(example))).toMatchObject({ version: 1, job: 'e2e-meet' });
  });

  it('refuses a failure from a tool it does not know', () => {
    const [step] = REPORT.steps;
    const failure = { ...step?.failures[0], tool: 'jest' };

    expect(() => parseCiReport({ ...REPORT, steps: [{ ...step, failures: [failure] }] })).toThrow(
      /tool/,
    );
  });
});
