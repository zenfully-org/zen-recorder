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


src/lib/b.test.ts format ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  × Formatter would have printed the following content:

    57 57 │     });
    58 58 │
    59    │ - ··it("reads·the·example",·()·=>·{
       59 │ + ··it('reads·the·example',·()·=>·{
    60 60 │       const contributing = readFileSync(


Checked 2 files in 7ms. No fixes applied.
Found 2 errors.
Found 1 warning.
check ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  × Some errors were emitted while running checks.

`;

describe('extractBiomeErrors', () => {
  it('reads every error with its rule, its place and its code frame, and leaves warnings out', () => {
    expect(extractBiomeErrors(OUTPUT)).toEqual([
      {
        tool: 'biome',
        message: [
          'Using == may be unsafe if you are relying on type coercion.',
          "> 4 │   if (value == 'x') return n",
          '    │             ^^',
        ].join('\n'),
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
        message: [
          'Formatter would have printed the following content (pnpm check:fix formats the file):',
          '  57 57 │     });',
          '  58 58 │',
          '  59    │ - ··it("reads·the·example",·()·=>·{',
          "     59 │ + ··it('reads·the·example',·()·=>·{",
          '  60 60 │       const contributing = readFileSync(',
        ].join('\n'),
        file: 'src/lib/b.test.ts',
        line: 59,
        column: null,
        rule: 'format',
        test: null,
        scenario: null,
        provider: null,
      },
    ]);
  });

  it('places a format error whose frame marks no changed line on its first numbered line', () => {
    const log = [
      'src/lib/c.ts format ━━━━━━',
      '',
      '  × Formatter would have printed the following content:',
      '  ',
      "    4 │ ··if·(value·==·'x')·return·n;",
      '      │                             +',
    ].join('\n');

    expect(extractBiomeErrors(log)[0]?.line).toBe(4);
  });

  it('keeps a long code frame to its first lines', () => {
    const frame = Array.from({ length: 20 }, (_, index) => `    ${index + 1} │ line`);
    const log = ['src/a.ts:1:1 parse ━━━━━━', '', '  × Expected an expression.', ...frame].join(
      '\n',
    );

    expect(extractBiomeErrors(log)[0]?.message.split('\n')).toHaveLength(11);
  });

  it('finds nothing in output without diagnostics', () => {
    expect(extractBiomeErrors('Checked 380 files in 120ms. No fixes applied.')).toEqual([]);
  });
});
