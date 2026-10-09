// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { buildReport } from './build-report';
import type { Clone, Failure, Finding, Measurement } from './types';

function measured(file: string, key: string, metric: string, value: number, line = 1): Measurement {
  return { file, key, metric, value, line };
}

const measurements: Measurement[] = [
  measured('src/lib/a.ts', 'file', 'max-lines', 120, 0),
  measured('src/lib/a.ts', 'createA', 'max-lines-per-function', 90, 3),
  measured('src/lib/a.ts', 'createA', 'cyclomatic-complexity', 12, 3),
  measured('src/lib/a.ts', 'createA', 'cognitive-complexity', 7, 4),
  measured('src/lib/a.ts', 'createA > handle', 'max-lines-per-function', 10, 9),
  measured('src/lib/a.ts', 'createA > handle', 'cyclomatic-complexity', 2, 9),
  measured('src/lib/b.ts', 'file', 'max-lines', 30, 0),
  measured('src/lib/b.ts', 'b', 'max-lines-per-function', 5, 1),
  measured('src/lib/b.ts', 'b', 'cyclomatic-complexity', 1, 1),
];

const thresholds = {
  'src/lib/a.ts': { 'max-lines-per-function': 80, 'cyclomatic-complexity': 10, 'max-lines': 400 },
  'src/lib/b.ts': { 'max-lines-per-function': 80, 'cyclomatic-complexity': 10, 'max-lines': 400 },
};

const findings: Finding[] = [
  {
    file: 'src/lib/a.ts',
    line: 3,
    key: 'createA',
    metric: 'max-lines-per-function',
    value: 90,
    threshold: 80,
  },
  {
    file: 'src/lib/a.ts',
    line: 3,
    key: 'createA',
    metric: 'cyclomatic-complexity',
    value: 12,
    threshold: 10,
  },
  {
    file: 'src/lib/a.ts',
    line: 5,
    key: 'createA',
    metric: 'no-nested-conditional',
    value: 1,
    threshold: null,
  },
];

const failure: Failure = {
  kind: 'new',
  file: 'src/lib/a.ts',
  key: 'createA',
  metric: 'no-nested-conditional',
  value: 1,
  baseline: null,
  threshold: null,
  line: 5,
};

const clone: Clone = {
  lines: 12,
  isNew: false,
  first: { file: 'src/lib/a.ts', line: 20 },
  second: { file: 'src/lib/b.ts', line: 2 },
};

const input = {
  generatedAt: '2026-10-05T12:00:00.000Z',
  measurements: { measurements, thresholds },
  findings,
  baseline: {
    'src/lib/a.ts': {
      createA: { 'max-lines-per-function': 95, 'cyclomatic-complexity': 12 },
      'createA > gone': { 'max-params': 5 },
      'createA > handle': { 'unused-export': 1 },
    },
  },
  failures: [failure],
  passed: false,
  clones: [clone],
  staleClones: 0,
  knownClones: 1,
  importViolations: [],
};

describe('buildReport', () => {
  it('has exactly the fields of version 1, the shape report.html documents', () => {
    expect(Object.keys(buildReport(input))).toEqual([
      'version',
      'generatedAt',
      'passed',
      'summary',
      'functionMetrics',
      'fileMetrics',
      'distributions',
      'worst',
      'files',
      'failures',
      'baseline',
      'clones',
      'importViolations',
    ]);
  });

  it('is version 1 and says whether the run passed, with the counts', () => {
    const report = buildReport(input);
    expect(report.version).toBe(1);
    expect(report.generatedAt).toBe('2026-10-05T12:00:00.000Z');
    expect(report.passed).toBe(false);
    expect(report.summary).toEqual({
      files: 2,
      functions: 3,
      failures: 1,
      newClones: 0,
      staleClones: 0,
      importViolations: 0,
      knownOffenders: 4,
      knownClones: 1,
    });
  });

  it('passes when the gate passed, which a clone gone from the code or an improved value does not stop', () => {
    expect(buildReport({ ...input, failures: [], staleClones: 1, passed: true }).passed).toBe(true);
  });

  it('lists every file and function with every metric, 0 where a function has none, and the file thresholds', () => {
    const report = buildReport(input);
    expect(report.functionMetrics).toEqual([
      'cognitive-complexity',
      'cyclomatic-complexity',
      'max-lines-per-function',
    ]);
    expect(report.fileMetrics).toEqual(['max-lines']);
    expect(report.files).toEqual([
      {
        file: 'src/lib/a.ts',
        thresholds: thresholds['src/lib/a.ts'],
        metrics: { 'max-lines': 120 },
        functions: [
          {
            key: 'createA',
            line: 3,
            metrics: {
              'cognitive-complexity': 7,
              'cyclomatic-complexity': 12,
              'max-lines-per-function': 90,
            },
          },
          {
            key: 'createA > handle',
            line: 9,
            metrics: {
              'cognitive-complexity': 0,
              'cyclomatic-complexity': 2,
              'max-lines-per-function': 10,
            },
          },
        ],
      },
      {
        file: 'src/lib/b.ts',
        thresholds: thresholds['src/lib/b.ts'],
        metrics: { 'max-lines': 30 },
        functions: [
          {
            key: 'b',
            line: 1,
            metrics: {
              'cognitive-complexity': 0,
              'cyclomatic-complexity': 1,
              'max-lines-per-function': 5,
            },
          },
        ],
      },
    ]);
  });

  it('gives the median, the 90th percentile and the largest value of every metric', () => {
    expect(buildReport(input).distributions).toEqual([
      { metric: 'cognitive-complexity', count: 3, p50: 0, p90: 7, max: 7 },
      { metric: 'cyclomatic-complexity', count: 3, p50: 2, p90: 12, max: 12 },
      { metric: 'max-lines-per-function', count: 3, p50: 10, p90: 90, max: 90 },
      { metric: 'max-lines', count: 2, p50: 30, p90: 120, max: 120 },
    ]);
  });

  it('ranks the largest values of each metric with the threshold that applies', () => {
    const lines = buildReport(input).worst.find((w) => w.metric === 'max-lines-per-function');
    expect(lines?.entries).toEqual([
      { file: 'src/lib/a.ts', key: 'createA', line: 3, value: 90, threshold: 80 },
      { file: 'src/lib/a.ts', key: 'createA > handle', line: 9, value: 10, threshold: 80 },
      { file: 'src/lib/b.ts', key: 'b', line: 1, value: 5, threshold: 80 },
    ]);
  });

  it('keeps 20 entries per metric at most', () => {
    const many = Array.from({ length: 25 }, (_, n) =>
      measured('src/lib/c.ts', `f${n}`, 'max-params', n, n + 1),
    );
    const report = buildReport({ ...input, measurements: { measurements: many, thresholds: {} } });
    const params = report.worst.find((w) => w.metric === 'max-params');
    expect(params?.entries).toHaveLength(20);
    expect(params?.entries[0]).toEqual({
      file: 'src/lib/c.ts',
      key: 'f24',
      line: 25,
      value: 24,
      threshold: null,
    });
  });
});

describe('buildReport, beyond the measurements', () => {
  it('shows each baseline entry with what the code has now: the gate finding, else the measured value, else nothing', () => {
    expect(buildReport(input).baseline).toEqual([
      {
        file: 'src/lib/a.ts',
        key: 'createA',
        metric: 'cyclomatic-complexity',
        baseline: [12],
        current: [12],
      },
      {
        file: 'src/lib/a.ts',
        key: 'createA',
        metric: 'max-lines-per-function',
        baseline: [95],
        current: [90],
      },
      {
        file: 'src/lib/a.ts',
        key: 'createA > gone',
        metric: 'max-params',
        baseline: [5],
        current: [],
      },
      {
        file: 'src/lib/a.ts',
        key: 'createA > handle',
        metric: 'unused-export',
        baseline: [1],
        current: [],
      },
    ]);
  });

  it('passes the failures, the clones and the import violations through', () => {
    const violation = {
      rule: 'no-circular',
      from: 'src/lib/a.ts',
      to: ['src/lib/b.ts', 'src/lib/a.ts'],
    };
    const report = buildReport({ ...input, importViolations: [violation] });
    expect(report.failures).toEqual([failure]);
    expect(report.clones).toEqual([clone]);
    expect(report.importViolations).toEqual([violation]);
    expect(report.summary.importViolations).toBe(1);
  });
});
