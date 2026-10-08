// @vitest-environment node
import { formatAnnotations } from './format-annotations';
import type { CiReport, StepFailure } from './types';

const failure = (fields: Partial<StepFailure>): StepFailure => ({
  tool: 'tsc',
  message: 'Type mismatch.',
  file: 'src/lib/a.ts',
  line: 3,
  column: 9,
  rule: 'TS2322',
  test: null,
  scenario: null,
  provider: null,
  ...fields,
});

const report = (failures: StepFailure[]): CiReport => ({
  version: 1,
  job: 'gate',
  jobName: 'Gate',
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
  failedStep: 'types',
  steps: [
    {
      id: 'types',
      command: 'pnpm exec tsc --noEmit',
      status: 'failed',
      durationSeconds: 1,
      exitCode: 2,
      log: 'logs/types.log',
      failures,
    },
  ],
  artifacts: [],
});

describe('formatAnnotations', () => {
  it('puts each error that names a file on its line of the pull request', () => {
    expect(formatAnnotations(report([failure({})]))).toEqual([
      '::error file=src/lib/a.ts,line=3,col=9,title=tsc TS2322::Type mismatch.',
    ]);
  });

  it('escapes what a workflow command reads, in the message and in its properties', () => {
    const [line] = formatAnnotations(
      report([
        failure({
          tool: 'quality',
          file: 'src/lib/a,b.ts',
          line: null,
          column: null,
          rule: 'cognitive-complexity',
          message: 'createB > handle: 100 %\nnext line',
        }),
      ]),
    );

    expect(line).toBe(
      '::error file=src/lib/a%2Cb.ts,title=quality cognitive-complexity::createB > handle: 100 %25%0Anext line',
    );
  });

  it('annotates the job with an error that names no file, like a failed end-to-end check', () => {
    const lines = formatAnnotations(
      report([
        failure({
          tool: 'e2e',
          message: 'overlays mounted: expected 2, got 1',
          file: null,
          line: null,
          column: null,
          rule: null,
          test: 'scenarioProviderRouting',
          scenario: 'routing',
          provider: 'zoom',
        }),
      ]),
    );

    expect(lines).toEqual([
      '::error title=e2e zoom scenario routing::overlays mounted: expected 2, got 1',
    ]);
  });

  it('leaves out the errors their tool already annotated, and the end of a log', () => {
    const lines = formatAnnotations(
      report([
        failure({ tool: 'vitest', test: 'a > b' }),
        failure({ tool: 'annotation' }),
        failure({ tool: 'log', file: null, rule: null }),
      ]),
    );

    expect(lines).toEqual([]);
  });

  it('stops at the 10 errors GitHub shows for a step', () => {
    const failures = Array.from({ length: 12 }, (_, line) => failure({ line: line + 1 }));

    expect(formatAnnotations(report(failures))).toHaveLength(10);
  });
});
