// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { renderReportHtml } from './render-report-html';
import type { QualityReport } from './types';

const report: QualityReport = {
  version: 1,
  generatedAt: '2026-10-05T12:00:00.000Z',
  passed: false,
  summary: {
    files: 1,
    functions: 2,
    failures: 1,
    newClones: 1,
    staleClones: 0,
    importViolations: 1,
    knownOffenders: 1,
    knownClones: 0,
  },
  functionMetrics: ['cyclomatic-complexity', 'max-lines-per-function'],
  fileMetrics: ['max-lines'],
  distributions: [
    { metric: 'cyclomatic-complexity', count: 2, p50: 2, p90: 12, max: 12 },
    { metric: 'max-lines-per-function', count: 2, p50: 10, p90: 90, max: 90 },
    { metric: 'max-lines', count: 1, p50: 120, p90: 120, max: 120 },
  ],
  worst: [
    {
      metric: 'cyclomatic-complexity',
      entries: [{ file: 'src/lib/a.ts', key: 'createA', line: 3, value: 12, threshold: 10 }],
    },
  ],
  files: [
    {
      file: 'src/lib/a.ts',
      thresholds: { 'cyclomatic-complexity': 10, 'max-lines-per-function': 80, 'max-lines': 400 },
      metrics: { 'max-lines': 120 },
      functions: [
        {
          key: 'createA',
          line: 3,
          metrics: { 'cyclomatic-complexity': 12, 'max-lines-per-function': 90 },
        },
        {
          key: 'createA > <handle>',
          line: 9,
          metrics: { 'cyclomatic-complexity': 2, 'max-lines-per-function': 10 },
        },
      ],
    },
  ],
  failures: [
    {
      kind: 'new',
      file: 'src/lib/a.ts',
      key: 'createA',
      metric: 'no-nested-conditional',
      value: 1,
      baseline: null,
      threshold: null,
      line: 5,
    },
  ],
  baseline: [
    {
      file: 'src/lib/a.ts',
      key: 'createA',
      metric: 'max-lines-per-function',
      baseline: [95],
      current: [90],
    },
  ],
  clones: [
    {
      lines: 12,
      isNew: true,
      first: { file: 'src/lib/a.ts', line: 20 },
      second: { file: 'src/lib/b.ts', line: 2 },
    },
  ],
  importViolations: [
    { rule: 'no-circular', from: 'src/lib/a.ts', to: ['src/lib/b.ts', 'src/lib/a.ts'] },
  ],
};

describe('renderReportHtml', () => {
  const html = renderReportHtml(report);

  it('is one page that loads nothing, so it opens from disk without a network', () => {
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).not.toMatch(/https?:\/\//);
    expect(html).not.toMatch(/<link|<img|\ssrc=/);
  });

  it('lists every function of a file with its numbers, and marks a value above its threshold', () => {
    expect(html).toContain(
      '<code>createA</code></td><td class="n" data-v="3">3</td><td class="n over" data-v="12">12</td>',
    );
    expect(html).toContain('<code>createA &gt; &lt;handle&gt;</code>');
  });

  it('says whether the gate passed and how report.json is shaped', () => {
    expect(html).toContain('<strong class="fail">The gate fails.</strong>');
    expect(html).toContain('How <code>report.json</code> is shaped (version 1)');
    expect(renderReportHtml({ ...report, passed: true })).toContain('The gate passes.');
  });

  it('renders a small report the same way every time', () => {
    expect(html).toMatchSnapshot();
  });
});
