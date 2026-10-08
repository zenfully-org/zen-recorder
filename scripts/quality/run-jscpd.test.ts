// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { runJscpd } from './run-jscpd';

const root = '/work/repo';
const tmp = '/tmp/jscpd-x';

function report(clones: { isNew: boolean }[]): string {
  return JSON.stringify({
    duplicates: clones.map(({ isNew }) => ({
      lines: 12,
      isNew,
      firstFile: { name: `${root}/src/a.ts`, startLoc: { line: 1 } },
      secondFile: { name: `${root}/src/b.ts`, startLoc: { line: 5 } },
    })),
    statistics: { total: {} },
  });
}

function fakes(files: Record<string, string>, code = 0) {
  const calls: string[][] = [];
  const removed: string[] = [];
  const deps = {
    root,
    exec: async (args: string[]) => {
      calls.push(args);
      return { code, stdout: '', stderr: code === 0 ? '' : 'jscpd: boom' };
    },
    readFile: async (file: string) => {
      const text = files[file];
      if (text === undefined) throw Object.assign(new Error(`ENOENT: ${file}`), { code: 'ENOENT' });
      return text;
    },
    makeTempDir: async () => tmp,
    removeDir: async (dir: string) => {
      removed.push(dir);
    },
  };
  return { deps, calls, removed };
}

const baseline = JSON.stringify({ version: 1, fingerprints: { a: 1, b: 1 } });

describe('runJscpd', () => {
  it('runs jscpd against the clone baseline, reads its report and counts the clones that are gone', async () => {
    const { deps, calls, removed } = fakes({
      [`${root}/.jscpd-baseline.json`]: baseline,
      [`${tmp}/jscpd-report.json`]: report([{ isNew: false }, { isNew: true }]),
    });
    const result = await runJscpd(deps, { updateBaseline: false });
    expect(result).toEqual({
      clones: [
        {
          lines: 12,
          isNew: false,
          first: { file: 'src/a.ts', line: 1 },
          second: { file: 'src/b.ts', line: 5 },
        },
        {
          lines: 12,
          isNew: true,
          first: { file: 'src/a.ts', line: 1 },
          second: { file: 'src/b.ts', line: 5 },
        },
      ],
      knownClones: 1,
      staleClones: 1,
    });
    expect(calls).toEqual([
      [
        'src',
        'scripts',
        'wxt.config.ts',
        'vitest.config.ts',
        '--reporters',
        'json',
        '--output',
        tmp,
        '--absolute',
        '--silent',
        '--no-tips',
        '--baseline',
        '.jscpd-baseline.json',
      ],
    ]);
    expect(removed).toEqual([tmp]);
  });

  it('passes --update-baseline through and reads the rewritten baseline, so nothing is stale after an update', async () => {
    const { deps, calls } = fakes({
      [`${root}/.jscpd-baseline.json`]: JSON.stringify({ version: 1, fingerprints: { a: 1 } }),
      [`${tmp}/jscpd-report.json`]: report([{ isNew: false }]),
    });
    const result = await runJscpd(deps, { updateBaseline: true });
    expect(calls[0]?.at(-1)).toBe('--update-baseline');
    expect(result.staleClones).toBe(0);
    expect(result.knownClones).toBe(1);
  });

  it('runs without the clone baseline when there is none yet, and every clone is new then, whatever the report says', async () => {
    const { deps, calls } = fakes({ [`${tmp}/jscpd-report.json`]: report([{ isNew: false }]) });
    const result = await runJscpd(deps, { updateBaseline: false });
    expect(calls[0]).not.toContain('--baseline');
    expect(result).toMatchObject({ knownClones: 0, staleClones: 0 });
    expect(result.clones.map((clone) => clone.isNew)).toEqual([true]);
  });

  it('creates the clone baseline when asked and there is none yet', async () => {
    const { deps, calls } = fakes({ [`${tmp}/jscpd-report.json`]: report([]) });
    await expect(runJscpd(deps, { updateBaseline: true })).resolves.toEqual({
      clones: [],
      knownClones: 0,
      staleClones: 0,
    });
    expect(calls[0]?.slice(-3)).toEqual([
      '--baseline',
      '.jscpd-baseline.json',
      '--update-baseline',
    ]);
  });

  it('fails with what jscpd printed when it exits with an error', async () => {
    const { deps, removed } = fakes({ [`${root}/.jscpd-baseline.json`]: baseline }, 2);
    await expect(runJscpd(deps, { updateBaseline: false })).rejects.toThrow(
      /jscpd exited with 2: jscpd: boom/,
    );
    expect(removed).toEqual([tmp]);
  });
});
