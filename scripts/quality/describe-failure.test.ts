// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { describeFailure } from './describe-failure';
import type { Failure } from './types';

const improved: Failure = {
  kind: 'improved',
  file: 'src/lib/finalize/remux-webm.ts',
  key: 'remuxWebm',
  metric: 'cyclomatic-complexity',
  value: 11,
  baseline: 12,
  threshold: 10,
  line: 20,
};

describe('describeFailure', () => {
  it('says what to do when the improvement fails the run', () => {
    expect(describeFailure(improved, { asSlack: false })).toBe(
      'src/lib/finalize/remux-webm.ts:20  remuxWebm  cyclomatic-complexity 11 > 10  improved (baseline 12): lower the baseline with pnpm check:quality --update-baseline',
    );
  });

  it('gives only the numbers when the improvement is listed as slack', () => {
    expect(describeFailure(improved, { asSlack: true })).toBe(
      'src/lib/finalize/remux-webm.ts:20  remuxWebm  cyclomatic-complexity 11 > 10  improved (baseline 12)',
    );
    expect(describeFailure({ ...improved, value: null, line: null }, { asSlack: true })).toBe(
      'src/lib/finalize/remux-webm.ts  remuxWebm  cyclomatic-complexity  gone (baseline 12)',
    );
    expect(
      describeFailure(
        { ...improved, kind: 'stale', key: 'old', value: null, threshold: null, line: null },
        { asSlack: true },
      ),
    ).toBe('src/lib/finalize/remux-webm.ts  old  cyclomatic-complexity  stale entry (baseline 12)');
  });
});
