// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { parseJscpdReport } from './parse-jscpd-report';

const root = '/work/repo';

function report(duplicates: unknown[], total: Record<string, number> = {}): string {
  return JSON.stringify({
    duplicates,
    statistics: {
      detectionDate: '2026-10-05',
      formats: {},
      total: { clones: duplicates.length, ...total },
    },
  });
}

function clone(first: string, second: string, isNew?: boolean) {
  return {
    format: 'typescript',
    lines: 22,
    tokens: 159,
    fragment: '...',
    ...(isNew === undefined ? {} : { isNew }),
    firstFile: { name: first, startLoc: { line: 12, column: 1 }, endLoc: { line: 33, column: 2 } },
    secondFile: {
      name: second,
      startLoc: { line: 16, column: 1 },
      endLoc: { line: 37, column: 2 },
    },
  };
}

describe('parseJscpdReport', () => {
  it('lists the clones with paths relative to the repository and says which are new', () => {
    const text = report([
      clone(
        `${root}/src/lib/protocol/parse-page-config.ts`,
        `${root}/src/lib/settings/parse-settings.ts`,
        false,
      ),
      clone(`${root}/scripts/e2e/scenarios.ts`, `${root}/scripts/e2e/scenarios.ts`, true),
    ]);
    expect(parseJscpdReport(text, root)).toEqual({
      clones: [
        {
          lines: 22,
          isNew: false,
          first: { file: 'src/lib/protocol/parse-page-config.ts', line: 12 },
          second: { file: 'src/lib/settings/parse-settings.ts', line: 16 },
        },
        {
          lines: 22,
          isNew: true,
          first: { file: 'scripts/e2e/scenarios.ts', line: 12 },
          second: { file: 'scripts/e2e/scenarios.ts', line: 16 },
        },
      ],
    });
  });

  it('treats a clone without the isNew flag (a run without a baseline) as new', () => {
    const text = report([clone(`${root}/src/a.ts`, `${root}/src/b.ts`)]);
    expect(parseJscpdReport(text, root).clones[0]?.isNew).toBe(true);
  });

  it('turns Windows separators into forward slashes', () => {
    const text = report([clone('C:\\work\\repo\\src\\a.ts', 'C:\\work\\repo\\src\\b.ts', false)]);
    expect(parseJscpdReport(text, 'C:\\work\\repo').clones[0]?.first.file).toBe('src/a.ts');
  });

  it('refuses a report of another shape', () => {
    expect(() => parseJscpdReport('{"duplicates": "none"}', root)).toThrow(/jscpd/);
  });
});
