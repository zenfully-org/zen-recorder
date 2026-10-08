// @vitest-environment node
import { extractBiomeErrors } from './extract-biome-errors';

/** What `biome check` prints for a file with a warning, a lint error and a format error. */
const OUTPUT = `$ biome check . && tsx scripts/check-conventions.ts
src/lib/a.ts:2:3 lint/style/useConst  FIXABLE  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  ! This let declares a variable that is only assigned once.

    1 │ export function a(value: string): number {
  > 2 │   let unused = 1;
      │   ^^^

  i Safe fix: Use const instead.


src/lib/a.ts:4:13 lint/suspicious/noDoubleEquals  FIXABLE  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  × Using == may be unsafe if you are relying on type coercion.

  > 4 │   if (value == 'x') return n
      │             ^^

  i == is only allowed when comparing against null.


src/lib/a.ts format ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  × Formatter would have printed the following content:

    4 │ ··if·(value·==·'x')·return·n;
      │                             +

Checked 1 file in 7ms. No fixes applied.
Found 2 errors.
Found 1 warning.
check ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  × Some errors were emitted while running checks.

`;

describe('extractBiomeErrors', () => {
  it('reads every error with its rule and place, and leaves the warnings out', () => {
    expect(extractBiomeErrors(OUTPUT)).toEqual([
      {
        tool: 'biome',
        message: 'Using == may be unsafe if you are relying on type coercion.',
        file: 'src/lib/a.ts',
        line: 4,
        column: 13,
        rule: 'lint/suspicious/noDoubleEquals',
        test: null,
        scenario: null,
        provider: null,
      },
      {
        tool: 'biome',
        message: 'Formatter would have printed the following content:',
        file: 'src/lib/a.ts',
        line: null,
        column: null,
        rule: 'format',
        test: null,
        scenario: null,
        provider: null,
      },
    ]);
  });

  it('finds nothing in output without diagnostics', () => {
    expect(extractBiomeErrors('Checked 380 files in 120ms. No fixes applied.')).toEqual([]);
  });
});
