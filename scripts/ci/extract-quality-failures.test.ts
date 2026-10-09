// @vitest-environment node
import { extractQualityFailures } from './extract-quality-failures';

/** What `pnpm check:quality` prints with a failure of each kind. */
const OUTPUT = `Quality gates: 6 failures

  src/lib/a.ts  file  unused-file  new offender
  src/lib/b.ts:3  createB > handle  cognitive-complexity 17 > 15  got worse (baseline 16)

Duplicated blocks: 1 new
  12 lines  src/lib/c.ts:4  src/lib/d.ts:9
  2 known clones are gone: prune .jscpd-baseline.json with pnpm check:quality --update-baseline

Import rules (.dependency-cruiser.cjs): 1 broken
  no-circular  src/lib/e.ts → src/lib/f.ts → src/lib/e.ts

Rules: eslint.config.js (metrics and code smells), .jscpd.json (clones), knip.jsonc (unused code). Known offenders: quality-baseline.json and .jscpd-baseline.json, which may only shrink.
report: .quality/report.html, .quality/report.json`;

const empty = {
  tool: 'quality',
  file: null,
  line: null,
  column: null,
  rule: null,
  test: null,
  scenario: null,
  provider: null,
};

describe('extractQualityFailures', () => {
  it('reads each failure, new clone and broken import rule of the summary', () => {
    expect(extractQualityFailures(OUTPUT)).toEqual([
      {
        ...empty,
        message: 'file: unused-file, new offender',
        file: 'src/lib/a.ts',
        rule: 'unused-file',
      },
      {
        ...empty,
        message: 'createB > handle: cognitive-complexity 17 > 15, got worse (baseline 16)',
        file: 'src/lib/b.ts',
        line: 3,
        rule: 'cognitive-complexity',
      },
      {
        ...empty,
        message: '12 lines repeat src/lib/d.ts:9',
        file: 'src/lib/c.ts',
        line: 4,
        rule: 'duplicated-block',
      },
      {
        ...empty,
        message:
          '2 known clones are gone: prune .jscpd-baseline.json with pnpm check:quality --update-baseline',
      },
      {
        ...empty,
        message: 'src/lib/e.ts → src/lib/f.ts → src/lib/e.ts',
        file: 'src/lib/e.ts',
        rule: 'no-circular',
      },
    ]);
  });

  it('leaves out what could be lowered: a better value than its baseline does not fail the gate', () => {
    const output = [
      'Quality gates: 1 failure',
      '',
      '  src/lib/a.ts  file  unused-file  new offender',
      '',
      'Could be lowered with pnpm check:quality --update-baseline: 1 baseline entry, 2 known clones',
      '  src/lib/b.ts:3  createB  max-params 5 > 4  improved (baseline 6)',
      '  2 known clones are gone from the code',
      '',
      'Rules: eslint.config.js (metrics and code smells).',
    ].join('\n');
    expect(extractQualityFailures(output)).toEqual([
      {
        ...empty,
        message: 'file: unused-file, new offender',
        file: 'src/lib/a.ts',
        rule: 'unused-file',
      },
    ]);
  });

  it('finds nothing when the gates pass', () => {
    expect(
      extractQualityFailures('Quality gates: ok (141 known offenders in quality-baseline.json)'),
    ).toEqual([]);
  });
});
