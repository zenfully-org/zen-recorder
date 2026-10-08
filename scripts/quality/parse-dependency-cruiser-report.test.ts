// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { parseDependencyCruiserReport } from './parse-dependency-cruiser-report';

/** The JSON report `depcruise --output-type json` writes, cut down to what the gate reads plus a few fields it ignores. */
function report(violations: unknown[]): string {
  return JSON.stringify({
    modules: [],
    summary: {
      violations,
      error: violations.length,
      warn: 0,
      info: 0,
      ignore: 0,
      totalCruised: 369,
      totalDependenciesCruised: 966,
      optionsUsed: {},
    },
  });
}

const cycle = {
  type: 'cycle',
  from: 'src/lib/page/reduce-lifecycle.ts',
  to: 'src/lib/types.ts',
  unresolvedTo: '@/lib/types',
  dependencyTypes: ['aliased', 'aliased-webpack', 'local', 'type-only', 'import'],
  rule: { severity: 'error', name: 'no-circular' },
  cycle: [
    { name: 'src/lib/types.ts', dependencyTypes: ['aliased', 'local', 'type-only', 'import'] },
    { name: 'src/lib/page/reduce-lifecycle.ts', dependencyTypes: ['local', 'type-only', 'import'] },
  ],
};

const unresolvable = {
  type: 'dependency',
  from: 'src/lib/page/c.ts',
  to: './no-such-module',
  unresolvedTo: './no-such-module',
  dependencyTypes: ['unknown'],
  rule: { severity: 'error', name: 'not-to-unresolvable' },
};

describe('parseDependencyCruiserReport', () => {
  it('gives a circular import as the chain of files it runs through, back to the first', () => {
    expect(parseDependencyCruiserReport(report([cycle]))).toEqual([
      {
        rule: 'no-circular',
        from: 'src/lib/page/reduce-lifecycle.ts',
        to: ['src/lib/types.ts', 'src/lib/page/reduce-lifecycle.ts'],
      },
    ]);
  });

  it('gives any other broken rule as the importing file and the import as written', () => {
    expect(parseDependencyCruiserReport(report([unresolvable]))).toEqual([
      { rule: 'not-to-unresolvable', from: 'src/lib/page/c.ts', to: ['./no-such-module'] },
    ]);
  });

  it('gives nothing for a report without violations', () => {
    expect(parseDependencyCruiserReport(report([]))).toEqual([]);
  });

  it('refuses a report of another shape', () => {
    expect(() => parseDependencyCruiserReport('{"summary": {"violations": "none"}}')).toThrow(
      /dependency-cruiser report has an unexpected shape/,
    );
  });

  it('refuses text that is not JSON, such as an error message on standard output', () => {
    expect(() => parseDependencyCruiserReport('ERROR: something went wrong')).toThrow(
      /dependency-cruiser report is not JSON/,
    );
  });
});
