// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { formatSummary } from './format-summary';
import type { Clone, Failure } from './types';

const base = {
  failures: [],
  newClones: [],
  staleClones: 0,
  knownOffenders: 45,
  knownClones: 4,
  importViolations: [],
  slack: [],
  goneClones: 0,
};

function failure(partial: Partial<Failure>): Failure {
  return {
    kind: 'new',
    file: 'src/lib/page/create-page-session.ts',
    key: 'createPageSession > handle > arrow#2',
    metric: 'cognitive-complexity',
    value: 17,
    baseline: null,
    threshold: 15,
    line: 296,
    ...partial,
  };
}

const clone: Clone = {
  lines: 22,
  isNew: true,
  first: { file: 'src/lib/protocol/parse-page-config.ts', line: 12 },
  second: { file: 'src/lib/settings/parse-settings.ts', line: 16 },
};

describe('formatSummary', () => {
  it('is one line when everything passes', () => {
    expect(formatSummary(base)).toBe(
      'Quality gates: ok (45 known offenders in quality-baseline.json, 4 known clones in .jscpd-baseline.json, no circular imports)',
    );
  });

  it('names each failure with its place, function, metric, numbers and what to do', () => {
    const text = formatSummary({
      ...base,
      failures: [
        failure({}),
        failure({
          kind: 'worse',
          key: 'createPageSession',
          metric: 'max-lines-per-function',
          value: 440,
          baseline: 434,
          threshold: 80,
          line: 135,
        }),
        failure({
          kind: 'improved',
          file: 'src/lib/finalize/remux-webm.ts',
          key: 'remuxWebm',
          metric: 'cyclomatic-complexity',
          value: 11,
          baseline: 12,
          threshold: 10,
          line: 20,
        }),
        failure({
          kind: 'stale',
          file: 'src/lib/finalize/remux-webm.ts',
          key: 'old',
          metric: 'max-params',
          value: null,
          baseline: 5,
          threshold: null,
          line: null,
        }),
        failure({
          kind: 'improved',
          file: 'src/lib/finalize/remux-webm.ts',
          key: 'remuxWebm',
          metric: 'expression-complexity',
          value: null,
          baseline: 4,
          threshold: null,
          line: null,
        }),
      ],
    });
    expect(text).toContain('Quality gates: 5 failures');
    expect(text).toContain(
      '  src/lib/finalize/remux-webm.ts  remuxWebm  expression-complexity  gone (baseline 4): lower the baseline with pnpm check:quality --update-baseline',
    );
    expect(text).toContain(
      '  src/lib/page/create-page-session.ts:296  createPageSession > handle > arrow#2  cognitive-complexity 17 > 15  new offender',
    );
    expect(text).toContain(
      '  src/lib/page/create-page-session.ts:135  createPageSession  max-lines-per-function 440 > 80  got worse (baseline 434)',
    );
    expect(text).toContain(
      '  src/lib/finalize/remux-webm.ts:20  remuxWebm  cyclomatic-complexity 11 > 10  improved (baseline 12): lower the baseline with pnpm check:quality --update-baseline',
    );
    expect(text).toContain(
      '  src/lib/finalize/remux-webm.ts  old  max-params  stale entry (baseline 5): remove it with pnpm check:quality --update-baseline',
    );
    expect(text).toContain(
      'Rules: eslint.config.js (metrics and code smells), .jscpd.json (clones), knip.jsonc (unused code).',
    );
  });

  it('lists new clones and says when the clone baseline holds clones that are gone', () => {
    const text = formatSummary({ ...base, newClones: [clone], staleClones: 2 });
    expect(text).toContain('Quality gates: 2 failures');
    expect(text).toContain('Duplicated blocks: 1 new');
    expect(text).toContain(
      '  22 lines  src/lib/protocol/parse-page-config.ts:12  src/lib/settings/parse-settings.ts:16',
    );
    expect(text).toContain(
      '  2 known clones are gone: prune .jscpd-baseline.json with pnpm check:quality --update-baseline',
    );
  });

  it('names a file-level finding by its file alone, without a line', () => {
    const text = formatSummary({
      ...base,
      failures: [
        failure({
          key: 'file',
          metric: 'max-lines',
          value: 1741,
          baseline: 1511,
          threshold: 800,
          line: 0,
          kind: 'worse',
        }),
      ],
    });
    expect(text).toContain(
      '  src/lib/page/create-page-session.ts  file  max-lines 1741 > 800  got worse (baseline 1511)',
    );
  });

  it('lists every broken import rule with the chain of files, and says where the rules are', () => {
    const text = formatSummary({
      ...base,
      importViolations: [
        {
          rule: 'no-circular',
          from: 'src/lib/page/reduce-lifecycle.ts',
          to: ['src/lib/types.ts', 'src/lib/page/reduce-lifecycle.ts'],
        },
        { rule: 'not-to-unresolvable', from: 'src/lib/page/c.ts', to: ['./no-such-module'] },
      ],
    });
    expect(text).toContain('Quality gates: 2 failures');
    expect(text).toContain(
      [
        'Import rules (.dependency-cruiser.cjs): 2 broken',
        '  no-circular  src/lib/page/reduce-lifecycle.ts → src/lib/types.ts → src/lib/page/reduce-lifecycle.ts',
        '  not-to-unresolvable  src/lib/page/c.ts → ./no-such-module',
        '',
      ].join('\n'),
    );
  });

  it('names a yes-or-no finding, such as an unused export, without a value', () => {
    const text = formatSummary({
      ...base,
      failures: [
        failure({
          file: 'src/lib/page/reduce-lifecycle.ts',
          key: 'throwawayHelper',
          metric: 'unused-export',
          value: 1,
          threshold: null,
          line: 300,
        }),
        failure({
          kind: 'stale',
          file: 'src/lib/types.ts',
          key: 'VideoMode',
          metric: 'unused-type',
          value: null,
          baseline: 1,
          threshold: null,
          line: null,
        }),
      ],
    });
    expect(text).toContain(
      '  src/lib/page/reduce-lifecycle.ts:300  throwawayHelper  unused-export  new offender',
    );
    expect(text).toContain(
      '  src/lib/types.ts  VideoMode  unused-type  stale entry (baseline 1): remove it with pnpm check:quality --update-baseline',
    );
  });

  it('counts one failure for a stale clone baseline without new clones', () => {
    expect(formatSummary({ ...base, staleClones: 1 })).toContain('Quality gates: 1 failure\n');
  });
});

describe('formatSummary and baseline slack', () => {
  const slack = [
    failure({
      kind: 'improved',
      file: 'src/lib/finalize/remux-webm.ts',
      key: 'remuxWebm',
      metric: 'cyclomatic-complexity',
      value: 11,
      baseline: 12,
      threshold: 10,
      line: 20,
    }),
    failure({
      kind: 'stale',
      file: 'src/lib/finalize/remux-webm.ts',
      key: 'old',
      metric: 'max-params',
      value: null,
      baseline: 5,
      threshold: null,
      line: null,
    }),
  ];

  it('passes, and lists what could be lowered and the command that lowers it', () => {
    expect(formatSummary({ ...base, slack, goneClones: 2 })).toBe(
      [
        'Quality gates: ok (45 known offenders in quality-baseline.json, 4 known clones in .jscpd-baseline.json, no circular imports)',
        '',
        'Could be lowered with pnpm check:quality --update-baseline: 2 baseline entries, 2 known clones',
        '  src/lib/finalize/remux-webm.ts:20  remuxWebm  cyclomatic-complexity 11 > 10  improved (baseline 12)',
        '  src/lib/finalize/remux-webm.ts  old  max-params  stale entry (baseline 5)',
        '  2 known clones are gone from the code',
      ].join('\n'),
    );
  });

  it('names one entry, or the clones alone, in the singular where it is one', () => {
    expect(formatSummary({ ...base, slack: slack.slice(0, 1) })).toContain(
      'Could be lowered with pnpm check:quality --update-baseline: 1 baseline entry\n',
    );
    expect(formatSummary({ ...base, goneClones: 1 })).toContain(
      'Could be lowered with pnpm check:quality --update-baseline: 1 known clone\n  1 known clone is gone from the code',
    );
  });

  it('counts only what fails, and lists the slack after it', () => {
    const text = formatSummary({ ...base, failures: [failure({})], slack });
    expect(text).toContain('Quality gates: 1 failure\n');
    expect(text.indexOf('new offender')).toBeLessThan(text.indexOf('Could be lowered'));
    expect(text.indexOf('Could be lowered')).toBeLessThan(text.indexOf('Rules:'));
  });
});

describe('formatSummary and inline ESLint comments', () => {
  it('says an inline eslint comment has no effect and asks to remove it', () => {
    const text = formatSummary({
      ...base,
      failures: [
        failure({
          file: 'src/lib/ui/mount-overlay.ts',
          key: 'file',
          metric: 'no-inline-config',
          value: 1,
          threshold: null,
          line: 1,
        }),
      ],
    });
    expect(text).toContain(
      '  src/lib/ui/mount-overlay.ts:1  file  no-inline-config  an inline eslint comment has no effect: remove it',
    );
  });
});
