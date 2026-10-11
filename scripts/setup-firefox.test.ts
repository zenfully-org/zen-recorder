// @vitest-environment node
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { PROCESS_BUDGET_MS } from './process-budget';

const REPO = path.resolve(import.meta.dirname, '..');

// The test starts Node with tsx on the setup command.
describe('pnpm setup:firefox --help', { timeout: PROCESS_BUDGET_MS }, () => {
  it('says what it downloads on each platform and how to use an installed Firefox instead', () => {
    const run = spawnSync(
      process.execPath,
      ['--import', 'tsx', 'scripts/setup-firefox.ts', '--help'],
      { cwd: REPO, encoding: 'utf8' },
    );

    expect(run.stderr).toBe('');
    expect(run.status).toBe(0);
    expect(run.stdout).toContain('Usage: pnpm setup:firefox');
    expect(run.stdout).toContain('.tools/firefox/firefox');
    expect(run.stdout).toContain('.tools/Firefox.app/Contents/MacOS/firefox');
    expect(run.stdout).toContain('.tools/firefox/core/firefox.exe');
    expect(run.stdout).toContain('E2E_FIREFOX');
    expect(run.stdout).toContain('--latest-version');
  });
});
