// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { compareBaseline } from './compare-baseline';
import type { Finding } from './types';

function finding(partial: Partial<Finding> = {}): Finding {
  return {
    file: 'src/lib/a.ts',
    line: 10,
    key: 'createA > handle',
    metric: 'cognitive-complexity',
    value: 17,
    threshold: 15,
    ...partial,
  };
}

describe('compareBaseline', () => {
  it('passes when every finding matches its entry exactly', () => {
    const baseline = { 'src/lib/a.ts': { 'createA > handle': { 'cognitive-complexity': 17 } } };
    expect(compareBaseline([finding()], baseline)).toEqual([]);
  });

  it('reports a finding without an entry as a new offender', () => {
    expect(compareBaseline([finding()], {})).toEqual([
      {
        kind: 'new',
        file: 'src/lib/a.ts',
        key: 'createA > handle',
        metric: 'cognitive-complexity',
        value: 17,
        baseline: null,
        threshold: 15,
        line: 10,
      },
    ]);
  });

  it('reports a value above its entry as worse, and below it as improved', () => {
    const baseline = { 'src/lib/a.ts': { 'createA > handle': { 'cognitive-complexity': 17 } } };
    expect(compareBaseline([finding({ value: 18 })], baseline)).toMatchObject([
      { kind: 'worse', value: 18, baseline: 17 },
    ]);
    expect(compareBaseline([finding({ value: 16 })], baseline)).toMatchObject([
      { kind: 'improved', value: 16, baseline: 17 },
    ]);
  });

  it('reports an entry nothing matches as stale, with the file and function it names', () => {
    const baseline = {
      'src/lib/a.ts': { 'createA > handle': { 'cognitive-complexity': 17, 'max-params': 5 } },
      'src/lib/gone.ts': { file: { 'max-lines': 500 } },
    };
    expect(compareBaseline([finding()], baseline)).toEqual([
      {
        kind: 'stale',
        file: 'src/lib/a.ts',
        key: 'createA > handle',
        metric: 'max-params',
        value: null,
        baseline: 5,
        threshold: null,
        line: null,
      },
      {
        kind: 'stale',
        file: 'src/lib/gone.ts',
        key: 'file',
        metric: 'max-lines',
        value: null,
        baseline: 500,
        threshold: null,
        line: null,
      },
    ]);
  });

  it('compares several findings of one function and metric value by value, largest first', () => {
    const four = finding({ metric: 'expression-complexity', value: 4, line: 20 });
    const five = finding({ metric: 'expression-complexity', value: 5, line: 30 });
    const baseline = {
      'src/lib/a.ts': { 'createA > handle': { 'expression-complexity': [5, 4] } },
    };
    expect(compareBaseline([four, five], baseline)).toEqual([]);
    // The 4 still matches its entry; the 5 is gone, and the baseline must lose it.
    expect(compareBaseline([four], baseline)).toMatchObject([
      { kind: 'improved', value: null, baseline: 5 },
    ]);
    expect(
      compareBaseline(
        [four, five, finding({ metric: 'expression-complexity', value: 4, line: 40 })],
        baseline,
      ),
    ).toMatchObject([{ kind: 'new', value: 4, baseline: null, line: 40 }]);
    expect(
      compareBaseline(
        [four, finding({ metric: 'expression-complexity', value: 6, line: 30 })],
        baseline,
      ),
    ).toMatchObject([{ kind: 'worse', value: 6, baseline: 5, line: 30 }]);
  });

  it('sorts the failures by file, function and metric', () => {
    const findings = [
      finding({ file: 'src/lib/b.ts', metric: 'max-params', value: 5, threshold: 4 }),
      finding({
        file: 'src/lib/a.ts',
        key: 'z',
        metric: 'max-lines-per-function',
        value: 90,
        threshold: 80,
      }),
      finding({ file: 'src/lib/a.ts', key: 'a', metric: 'max-params', value: 5, threshold: 4 }),
    ];
    expect(compareBaseline(findings, {}).map((f) => `${f.file} ${f.key} ${f.metric}`)).toEqual([
      'src/lib/a.ts a max-params',
      'src/lib/a.ts z max-lines-per-function',
      'src/lib/b.ts createA > handle max-params',
    ]);
  });
});
