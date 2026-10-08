// @vitest-environment node
import { extractTscErrors } from './extract-tsc-errors';

describe('extractTscErrors', () => {
  it('reads each error with its place, its code and the lines that explain it', () => {
    const log = [
      "src/lib/a.ts(3,9): error TS2322: Type '{ a: number; }' is not assignable to type 'B'.",
      "  Property 'b' is missing in type '{ a: number; }' but required in type 'B'.",
      "src/lib/b.ts(2,7): error TS6133: 'unused' is declared but its value is never read.",
      ' ELIFECYCLE  Command failed with exit code 2.',
    ].join('\n');

    expect(extractTscErrors(log)).toEqual([
      {
        tool: 'tsc',
        message:
          "Type '{ a: number; }' is not assignable to type 'B'.\n" +
          "  Property 'b' is missing in type '{ a: number; }' but required in type 'B'.",
        file: 'src/lib/a.ts',
        line: 3,
        column: 9,
        rule: 'TS2322',
        test: null,
        scenario: null,
        provider: null,
      },
      {
        tool: 'tsc',
        message: "'unused' is declared but its value is never read.",
        file: 'src/lib/b.ts',
        line: 2,
        column: 7,
        rule: 'TS6133',
        test: null,
        scenario: null,
        provider: null,
      },
    ]);
  });

  it('reads an error that has no place, like a broken tsconfig.json', () => {
    const log = "error TS5023: Unknown compiler option 'strictest'.";

    expect(extractTscErrors(log)).toEqual([
      expect.objectContaining({
        message: "Unknown compiler option 'strictest'.",
        file: null,
        rule: 'TS5023',
      }),
    ]);
  });

  it('finds nothing in output without TypeScript errors', () => {
    expect(extractTscErrors('Done in 2s')).toEqual([]);
  });
});
