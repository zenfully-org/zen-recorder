// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { runKnip } from './run-knip';

function fakes(result: { code: number | null; stdout: string; stderr: string }) {
  const calls: string[][] = [];
  const exec = async (args: string[]) => {
    calls.push(args);
    return result;
  };
  return { deps: { exec }, calls };
}

const stdout = `${JSON.stringify({
  issues: [{ file: 'scripts/e2e/targets.ts', exports: [{ name: 'fixtureFile', line: 48 }] }],
})}\n`;

describe('runKnip', () => {
  it('runs knip with its JSON report and without its exit code, and returns what it found', async () => {
    const { deps, calls } = fakes({ code: 0, stdout, stderr: '' });
    await expect(runKnip(deps)).resolves.toEqual([
      {
        file: 'scripts/e2e/targets.ts',
        line: 48,
        key: 'fixtureFile',
        metric: 'unused-export',
        value: 1,
        threshold: null,
      },
    ]);
    expect(calls).toEqual([['--reporter', 'json', '--no-progress', '--no-exit-code']]);
  });

  it('fails with what knip printed when it exits with an error, such as a configuration it refuses', async () => {
    const { deps } = fakes({ code: 2, stdout: '', stderr: 'ERROR: Invalid configuration' });
    await expect(runKnip(deps)).rejects.toThrow(/knip exited with 2: ERROR: Invalid configuration/);
  });

  it('fails with standard output when an error left nothing on standard error', async () => {
    const { deps } = fakes({ code: 2, stdout: 'Unexpected token', stderr: '' });
    await expect(runKnip(deps)).rejects.toThrow(/knip exited with 2: Unexpected token/);
  });
});
