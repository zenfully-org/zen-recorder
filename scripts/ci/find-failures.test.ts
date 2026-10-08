// @vitest-environment node
import { findFailures } from './find-failures';

const ROOT = '/work/repo';
const noCoverage = () => null;

describe('findFailures', () => {
  it('reads what each tool printed', () => {
    const log = [
      "src/lib/a.ts(3,9): error TS2322: Type 'string' is not assignable to type 'number'.",
      'Convention violations:',
      '  src/lib/b.ts: uses a class',
    ].join('\n');

    expect(findFailures(log, { root: ROOT, readCoverage: noCoverage })).toEqual([
      expect.objectContaining({ tool: 'tsc', file: 'src/lib/a.ts' }),
      expect.objectContaining({ tool: 'conventions', file: 'src/lib/b.ts' }),
    ]);
  });

  it('reads the log without its colours', () => {
    const log = '\u001b[31msrc/lib/a.ts(3,9): error TS2322: Type mismatch.\u001b[39m';

    expect(findFailures(log, { root: ROOT, readCoverage: noCoverage })).toEqual([
      expect.objectContaining({ tool: 'tsc', message: 'Type mismatch.' }),
    ]);
  });

  it('falls back on the end of the log when no tool it knows said what failed', () => {
    const log = 'Building...\nsomething went wrong\n ELIFECYCLE  Command failed with exit code 1.';

    expect(findFailures(log, { root: ROOT, readCoverage: noCoverage })).toEqual([
      expect.objectContaining({ tool: 'log', message: expect.stringContaining('went wrong') }),
    ]);
  });
});
