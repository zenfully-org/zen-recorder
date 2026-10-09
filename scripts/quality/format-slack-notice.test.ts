// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { formatSlackNotice } from './format-slack-notice';
import type { Failure } from './types';

function improved(line: number): Failure {
  return {
    kind: 'improved',
    file: 'src/entrypoints/background.ts',
    key: 'main',
    metric: 'max-lines-per-function',
    value: 202,
    baseline: 219,
    threshold: 80,
    line,
  };
}

describe('formatSlackNotice', () => {
  it('is nothing when the baselines have no slack', () => {
    expect(formatSlackNotice([], 0)).toBeNull();
  });

  it('is one notice for the run that lists every entry that could be lowered, newlines escaped', () => {
    expect(formatSlackNotice([improved(12)], 2)).toBe(
      '::notice title=Quality baseline slack::1 baseline entry and 2 known clones could be lowered with pnpm check:quality --update-baseline; the scheduled "Tight baselines" check fails until they are.' +
        '%0Asrc/entrypoints/background.ts:12  main  max-lines-per-function 202 > 80  improved (baseline 219)',
    );
  });

  it('counts known clones alone when no baseline entry could be lowered', () => {
    expect(formatSlackNotice([], 1)).toBe(
      '::notice title=Quality baseline slack::1 known clone could be lowered with pnpm check:quality --update-baseline; the scheduled "Tight baselines" check fails until they are.',
    );
  });

  it('shows 20 entries and says how many more the run printed', () => {
    const notice = formatSlackNotice(
      Array.from({ length: 23 }, (_, index) => improved(index + 1)),
      0,
    );
    expect(notice).toContain('::notice title=Quality baseline slack::23 baseline entries could be');
    expect(notice).toContain('%0Asrc/entrypoints/background.ts:20  main');
    expect(notice).not.toContain('%0Asrc/entrypoints/background.ts:21  main');
    expect(notice?.endsWith('%0A… 3 more in the output of pnpm check:quality')).toBe(true);
  });

  it('escapes a percent sign in a file name', () => {
    expect(formatSlackNotice([{ ...improved(1), file: 'src/100%.ts' }], 0)).toContain(
      '%0Asrc/100%25.ts:1',
    );
  });
});
