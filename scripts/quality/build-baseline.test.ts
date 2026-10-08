// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { buildBaseline } from './build-baseline';
import type { Finding } from './types';

function finding(partial: Partial<Finding>): Finding {
  return {
    file: 'src/lib/a.ts',
    line: 1,
    key: 'f',
    metric: 'max-params',
    value: 5,
    threshold: 4,
    ...partial,
  };
}

describe('buildBaseline', () => {
  it('writes one number per function and metric, and a list largest first when there are several', () => {
    const findings = [
      finding({
        file: 'src/lib/b.ts',
        key: 'g',
        metric: 'cognitive-complexity',
        value: 17,
        threshold: 15,
      }),
      finding({ metric: 'expression-complexity', value: 4, line: 2 }),
      finding({ metric: 'expression-complexity', value: 5, line: 3 }),
      finding({}),
    ];
    expect(buildBaseline(findings)).toEqual({
      'src/lib/a.ts': { f: { 'expression-complexity': [5, 4], 'max-params': 5 } },
      'src/lib/b.ts': { g: { 'cognitive-complexity': 17 } },
    });
  });

  it('sorts files, functions and metrics so the file diffs cleanly', () => {
    const findings = [
      finding({
        file: 'src/lib/z.ts',
        key: 'b',
        metric: 'max-statements',
        value: 41,
        threshold: 40,
      }),
      finding({ file: 'src/lib/z.ts', key: 'b', metric: 'max-params', value: 5 }),
      finding({ file: 'src/lib/z.ts', key: 'a', metric: 'max-params', value: 5 }),
      finding({
        file: 'src/lib/m.ts',
        key: 'file',
        metric: 'max-lines',
        value: 450,
        threshold: 400,
      }),
    ];
    const baseline = buildBaseline(findings);
    expect(Object.keys(baseline)).toEqual(['src/lib/m.ts', 'src/lib/z.ts']);
    expect(Object.keys(baseline['src/lib/z.ts'] ?? {})).toEqual(['a', 'b']);
    expect(Object.keys(baseline['src/lib/z.ts']?.['b'] ?? {})).toEqual([
      'max-params',
      'max-statements',
    ]);
  });

  it('never records an inline eslint comment, which the code has to lose instead', () => {
    const comment = finding({ metric: 'no-inline-config', value: 1, threshold: null });
    expect(buildBaseline([comment, finding({})])).toEqual({
      'src/lib/a.ts': { f: { 'max-params': 5 } },
    });
  });

  it('is empty without findings', () => {
    expect(buildBaseline([])).toEqual({});
  });
});
