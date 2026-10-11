// @vitest-environment node
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { listIgnoredFiles, listProjectFiles } from './git-files';
import { PROCESS_BUDGET_MS } from './process-budget';

let root: string;
let elsewhere: string;
const savedGlobalConfig = process.env['GIT_CONFIG_GLOBAL'];

function write(file: string, content = ''): void {
  mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
  writeFileSync(path.join(root, file), content);
}

const git = (...args: string[]) => execFileSync('git', args, { cwd: root, stdio: 'pipe' });

beforeAll(() => {
  root = mkdtempSync(path.join(os.tmpdir(), 'git-files-'));
  elsewhere = mkdtempSync(path.join(os.tmpdir(), 'git-files-none-'));
  // The developer's own global ignore rules must not decide what these tests see.
  const emptyConfig = path.join(elsewhere, 'gitconfig');
  writeFileSync(emptyConfig, '');
  process.env['GIT_CONFIG_GLOBAL'] = emptyConfig;
  git('init', '-q');
  write('.gitignore', '/src/scratch/\n');
  write('.git/info/exclude', '/src/excluded/\n');
  write('src/lib/tracked.ts');
  write('src/lib/gone.ts');
  write('other/outside.ts');
  git('add', 'src/lib/tracked.ts', 'src/lib/gone.ts', 'other/outside.ts');
  rmSync(path.join(root, 'src/lib/gone.ts'));
  write('src/lib/new.ts');
  write('src/scratch/a.test.ts');
  write('src/scratch/copy(1)[a].test.ts');
  write('src/excluded/b.test.ts');
  write('src/lib/own-ignore/.gitignore', '*\n');
  write('src/lib/own-ignore/m.ts');
});

afterAll(() => {
  if (savedGlobalConfig === undefined) delete process.env['GIT_CONFIG_GLOBAL'];
  else process.env['GIT_CONFIG_GLOBAL'] = savedGlobalConfig;
  rmSync(root, { recursive: true, force: true });
  rmSync(elsewhere, { recursive: true, force: true });
});

// The listings start git.
describe('listProjectFiles', { timeout: PROCESS_BUDGET_MS }, () => {
  it('lists the tracked files and the new ones no ignore rule covers, that are on disk', () => {
    expect(listProjectFiles(root, ['src']).sort()).toEqual([
      'src/lib/new.ts',
      'src/lib/tracked.ts',
    ]);
  });

  it('lists only under the given paths', () => {
    expect(listProjectFiles(root, ['other'])).toEqual(['other/outside.ts']);
  });
});

describe('listIgnoredFiles', { timeout: PROCESS_BUDGET_MS }, () => {
  it('lists every file git ignores, from .gitignore, info/exclude and a folder of its own', () => {
    expect(listIgnoredFiles(root, ['src']).sort()).toEqual([
      'src/excluded/b.test.ts',
      'src/lib/own-ignore/.gitignore',
      'src/lib/own-ignore/m.ts',
      'src/scratch/a.test.ts',
      'src/scratch/copy\\(1\\)\\[a\\].test.ts',
    ]);
  });

  it('writes each as a glob that matches only itself, under the given paths only', () => {
    expect(listIgnoredFiles(root, ['src/scratch']).sort()).toEqual([
      'src/scratch/a.test.ts',
      'src/scratch/copy\\(1\\)\\[a\\].test.ts',
    ]);
  });

  it('lists nothing outside a git working copy', () => {
    expect(listIgnoredFiles(elsewhere, ['src'])).toEqual([]);
  });
});
