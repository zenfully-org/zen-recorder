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

function fakes(cruise: (paths: string[]) => Promise<string>, listed: string[]) {
  const calls: string[][] = [];
  const deps = {
    cruise: (paths: string[]) => {
      calls.push(paths);
      return cruise(paths);
    },
    isListed: (file: string) => listed.includes(file),
  };
  return { deps, calls };
}

describe('runDependencyCruiser', () => {
  it('cruises src and scripts and returns what breaks the rules', async () => {
    const stdout = report([cycleThrough(['src/lib/a.ts', 'src/lib/b.ts'])]);
    const { deps, calls } = fakes(async () => stdout, ['src/lib/a.ts', 'src/lib/b.ts']);
    await expect(runDependencyCruiser(deps)).resolves.toEqual([
      { rule: 'no-circular', from: 'src/lib/a.ts', to: ['src/lib/b.ts', 'src/lib/a.ts'] },
    ]);
    expect(calls).toEqual([['src', 'scripts']]);
  });

  it('leaves out what starts in a file git does not list, such as a scratch folder git ignores', async () => {
    const stdout = report([
      cycleThrough(['src/scratch/a.ts', 'src/scratch/b.ts']),
      cycleThrough(['src/lib/a.ts', 'src/lib/b.ts']),
    ]);
    const { deps } = fakes(async () => stdout, ['src/lib/a.ts', 'src/lib/b.ts']);
    const violations = await runDependencyCruiser(deps);
    expect(violations.map((violation) => violation.from)).toEqual(['src/lib/a.ts']);
  });

  it('fails with what dependency-cruiser threw, such as a configuration it refuses', async () => {
    const { deps } = fakes(async () => {
      throw new Error('The supplied configuration is not valid');
    }, []);
    await expect(runDependencyCruiser(deps)).rejects.toThrow(
      /dependency-cruiser failed: The supplied configuration is not valid/,
    );
  });
});
