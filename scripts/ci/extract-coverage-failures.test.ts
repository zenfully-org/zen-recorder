// @vitest-environment node
import { extractCoverageFailures } from './extract-coverage-failures';

const ROOT = '/work/repo';

const position = (line: number) => ({
  start: { line, column: 2 },
  end: { line, column: 20 },
});

/** `.coverage/coverage-final.json` (Istanbul's format) with one file fully covered and one not. */
const COVERAGE = JSON.stringify({
  [`${ROOT}/src/lib/full.ts`]: {
    path: `${ROOT}/src/lib/full.ts`,
    statementMap: { 0: position(2) },
    fnMap: { 0: { name: 'full', decl: position(1), loc: position(1), line: 1 } },
    branchMap: {},
    s: { 0: 3 },
    f: { 0: 3 },
    b: {},
  },
  [`${ROOT}/src/lib/partial.ts`]: {
    path: `${ROOT}/src/lib/partial.ts`,
    statementMap: { 0: position(2), 1: position(12), 2: position(13), 3: position(14) },
    fnMap: {
      0: { name: 'partial', decl: position(1), loc: position(1), line: 1 },
      1: { name: 'unused', decl: position(12), loc: position(12), line: 12 },
    },
    branchMap: {
      0: { loc: position(4), type: 'if', locations: [position(4), position(6)], line: 4 },
      // An `if` without an `else`: Istanbul gives the missing branch no place.
      1: {
        loc: position(8),
        type: 'if',
        locations: [position(8), { start: {}, end: {} }],
        line: 8,
      },
    },
    s: { 0: 1, 1: 0, 2: 0, 3: 0 },
    f: { 0: 1, 1: 0 },
    b: { 0: [1, 0], 1: [1, 0] },
  },
});

const LOG = [
  'All files          |   99.12 |    99.80 |   99.67 |   99.20 |',
  'ERROR: Coverage for statements (99.12%) does not meet global threshold (100%)',
  'ERROR: Coverage for branches (99.8%) does not meet global threshold (100%)',
].join('\n');

const empty = {
  tool: 'coverage',
  file: null,
  line: null,
  column: null,
  rule: null,
  test: null,
  scenario: null,
  provider: null,
};

describe('extractCoverageFailures', () => {
  it('names each measure below its threshold, then each file and line left uncovered', () => {
    expect(extractCoverageFailures(LOG, () => COVERAGE, ROOT)).toEqual([
      { ...empty, message: 'statements: 99.12 % covered, 100 % required', rule: 'statements' },
      { ...empty, message: 'branches: 99.8 % covered, 100 % required', rule: 'branches' },
      {
        ...empty,
        message: 'not covered: lines 6, 8, 12-14 (3 statements, 2 branches, 1 function)',
        file: 'src/lib/partial.ts',
        line: 6,
      },
    ]);
  });

  it('names the measures alone when the coverage file is missing', () => {
    expect(extractCoverageFailures(LOG, () => null, ROOT)).toHaveLength(2);
  });

  it('reads no coverage file when no threshold was missed', () => {
    const readCoverage = vi.fn(() => COVERAGE);

    expect(extractCoverageFailures(' Tests  1 failed (856)', readCoverage, ROOT)).toEqual([]);
    expect(readCoverage).not.toHaveBeenCalled();
  });
});
