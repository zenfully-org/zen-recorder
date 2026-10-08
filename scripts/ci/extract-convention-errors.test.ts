// @vitest-environment node
import { extractConventionErrors } from './extract-convention-errors';

describe('extractConventionErrors', () => {
  it('reads each violation of `pnpm check:conventions`, with its place when it names one', () => {
    const log = [
      'Checked 380 files in 120ms. No fixes applied.',
      'Convention violations:',
      '  src/lib/a.ts: exports 2 functions (expected exactly 1)',
      '  src/lib/a.ts:2: type assertion "as number" (forcing a type is not allowed)',
      '  test code has 150 forced types, baseline is 147: new test code must not force types',
      ' ELIFECYCLE  Command failed with exit code 1.',
    ].join('\n');

    expect(extractConventionErrors(log)).toEqual([
      {
        tool: 'conventions',
        message: 'exports 2 functions (expected exactly 1)',
        file: 'src/lib/a.ts',
        line: null,
        column: null,
        rule: null,
        test: null,
        scenario: null,
        provider: null,
      },
      {
        tool: 'conventions',
        message: 'type assertion "as number" (forcing a type is not allowed)',
        file: 'src/lib/a.ts',
        line: 2,
        column: null,
        rule: null,
        test: null,
        scenario: null,
        provider: null,
      },
      {
        tool: 'conventions',
        message:
          'test code has 150 forced types, baseline is 147: new test code must not force types',
        file: null,
        line: null,
        column: null,
        rule: null,
        test: null,
        scenario: null,
        provider: null,
      },
    ]);
  });

  it('finds nothing when the conventions hold', () => {
    expect(extractConventionErrors('conventions ok: one exported function per module')).toEqual([]);
  });
});
