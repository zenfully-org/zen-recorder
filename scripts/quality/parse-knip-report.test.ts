// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { parseKnipReport } from './parse-knip-report';

/** One row of `knip --reporter json`: every issue type it reports, empty unless given. */
function row(file: string, issues: Record<string, unknown[]>) {
  return {
    file,
    binaries: [],
    catalog: [],
    catalogReferences: [],
    dependencies: [],
    devDependencies: [],
    duplicates: [],
    enumMembers: [],
    exports: [],
    files: [],
    namespaceMembers: [],
    optionalPeerDependencies: [],
    types: [],
    unlisted: [],
    unresolved: [],
    ...issues,
  };
}

function report(rows: unknown[]): string {
  return JSON.stringify({ issues: rows });
}

const finding = { value: 1, threshold: null };

describe('parseKnipReport', () => {
  it('gives an unused export or type as a finding on its file, named by the export', () => {
    const text = report([
      row('src/lib/types.ts', {
        types: [{ name: 'VideoMode', kind: 'type', line: 19, col: 13, pos: 640 }],
      }),
      row('scripts/e2e/targets.ts', { exports: [{ name: 'fixtureFile', line: 48, col: 14 }] }),
    ]);
    expect(parseKnipReport(text)).toEqual([
      { file: 'src/lib/types.ts', line: 19, key: 'VideoMode', metric: 'unused-type', ...finding },
      {
        file: 'scripts/e2e/targets.ts',
        line: 48,
        key: 'fixtureFile',
        metric: 'unused-export',
        ...finding,
      },
    ]);
  });

  it('gives an unused file under the key `file`, with no line', () => {
    const text = report([row('src/lib/old.ts', { files: [{ name: 'src/lib/old.ts' }] })]);
    expect(parseKnipReport(text)).toEqual([
      { file: 'src/lib/old.ts', line: 0, key: 'file', metric: 'unused-file', ...finding },
    ]);
  });

  it('gives a dependency on package.json, named by the package', () => {
    const text = report([
      row('package.json', {
        dependencies: [{ name: 'left-pad', line: 20, col: 6 }],
        devDependencies: [{ name: '@wxt-dev/browser', line: 66, col: 6 }],
        optionalPeerDependencies: [{ name: 'peer', line: 90, col: 6 }],
        binaries: [{ name: 'ffmpeg' }],
      }),
    ]);
    expect(parseKnipReport(text).map(({ key, metric, line }) => ({ key, metric, line }))).toEqual([
      { key: 'ffmpeg', metric: 'unlisted-binary', line: 0 },
      { key: 'left-pad', metric: 'unused-dependency', line: 20 },
      { key: '@wxt-dev/browser', metric: 'unused-dev-dependency', line: 66 },
      { key: 'peer', metric: 'unused-optional-peer-dependency', line: 90 },
    ]);
  });

  it('gives imports that are unresolved or of an unlisted package on the importing file', () => {
    const text = report([
      row('src/lib/a.ts', {
        unlisted: [{ name: 'lodash', line: 1, col: 1 }],
        unresolved: [{ name: './missing', line: 2, col: 1 }],
      }),
    ]);
    expect(parseKnipReport(text).map(({ key, metric }) => `${key} ${metric}`)).toEqual([
      'lodash unlisted-dependency',
      './missing unresolved-import',
    ]);
  });

  it('names a member by its enum or namespace, and a duplicate export by all its names', () => {
    const text = report([
      row('src/lib/a.ts', {
        enumMembers: [{ namespace: 'Mode', name: 'Off', line: 3 }],
        namespaceMembers: [{ namespace: 'Api', name: 'old', line: 9 }],
        duplicates: [[{ name: 'start' }, { name: 'begin' }]],
      }),
    ]);
    expect(parseKnipReport(text).map(({ key, metric }) => `${key} ${metric}`)).toEqual([
      'start = begin duplicate-export',
      'Mode.Off unused-enum-member',
      'Api.old unused-namespace-member',
    ]);
  });

  it('keeps knip’s own name for an issue type it does not know yet, rather than dropping it', () => {
    const text = report([row('src/lib/a.ts', { newKind: [{ name: 'thing', line: 4 }] })]);
    expect(parseKnipReport(text)).toEqual([
      { file: 'src/lib/a.ts', line: 4, key: 'thing', metric: 'newKind', ...finding },
    ]);
  });

  it('skips the owners knip adds to a row when the repository has a CODEOWNERS file', () => {
    const text = report([
      row('src/lib/a.ts', { owners: [{ name: '@team' }], exports: [{ name: 'a', line: 1 }] }),
    ]);
    expect(parseKnipReport(text).map(({ key }) => key)).toEqual(['a']);
  });

  it('gives nothing for a report without issues', () => {
    expect(parseKnipReport(report([]))).toEqual([]);
  });

  it('refuses a report of another shape', () => {
    expect(() => parseKnipReport('{"issues": [{"file": 3}]}')).toThrow(
      /knip report has an unexpected shape/,
    );
  });

  it('refuses text that is not JSON', () => {
    expect(() => parseKnipReport('Unused files (1)')).toThrow(/knip report is not JSON/);
  });
});
