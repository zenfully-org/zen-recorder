// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { runDependencyCruiser } from './run-dependency-cruiser';

function report(violations: unknown[]): string {
  return JSON.stringify({ modules: [], summary: { violations } });
}

function cycleThrough(files: string[]) {
  const [from = '', ...rest] = files;
  return {
    type: 'cycle',
    from,
    to: rest[0],
    rule: { severity: 'error', name: 'no-circular' },
    cycle: [...rest, from].map((name) => ({ name, dependencyTypes: ['local', 'import'] })),
  };
}

function fakes(cruise: (files: string[]) => Promise<string>) {
  const calls: string[][] = [];
  const deps = {
    cruise: (files: string[]) => {
      calls.push(files);
      return cruise(files);
    },
  };
  return { deps, calls };
}

describe('runDependencyCruiser', () => {
  it('returns what breaks the rules', async () => {
    const stdout = report([cycleThrough(['src/lib/a.ts', 'src/lib/b.ts'])]);
    const { deps } = fakes(async () => stdout);
    await expect(runDependencyCruiser(deps, ['src/lib/a.ts', 'src/lib/b.ts'])).resolves.toEqual([
      { rule: 'no-circular', from: 'src/lib/a.ts', to: ['src/lib/b.ts', 'src/lib/a.ts'] },
    ]);
  });

  it('cruises the listed files under src and scripts, never the folders, which hold what git ignores', async () => {
    const { deps, calls } = fakes(async () => report([]));
    await runDependencyCruiser(deps, [
      'scripts/quality/cruise-files.ts',
      'src/lib/a.ts',
      'src/entrypoints/popup/App.tsx',
      'wxt.config.ts',
      'vitest.config.ts',
      'docs/notes.ts',
      'srcfile.ts',
    ]);
    expect(calls).toEqual([
      ['scripts/quality/cruise-files.ts', 'src/lib/a.ts', 'src/entrypoints/popup/App.tsx'],
    ]);
  });

  it('fails with what dependency-cruiser threw, such as a configuration it refuses', async () => {
    const { deps } = fakes(async () => {
      throw new Error('The supplied configuration is not valid');
    });
    await expect(runDependencyCruiser(deps, [])).rejects.toThrow(
      /dependency-cruiser failed: The supplied configuration is not valid/,
    );
  });
});
