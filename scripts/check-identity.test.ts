// @vitest-environment node
/**
 * `scripts/check-identity.sh` (`pnpm check:identity`) run in a throwaway git repository: the
 * script is copied in, the patterns file holds invented names, and each test commits the files it
 * needs. Nothing here may spell a real identity: the check reads this file too.
 */
import { type SpawnSyncReturns, spawnSync } from 'node:child_process';
import {
  chmodSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const REPO = path.resolve(import.meta.dirname, '..');
// Where a working copy finds the patterns: the internal folder it links as `.internal`, which git
// ignores through .git/info/exclude.
const PATTERNS = '.internal/private/rewrite/patterns.txt';

let workingCopy = '';

beforeEach(() => {
  workingCopy = realpathSync(mkdtempSync(path.join(tmpdir(), 'zen-recorder-identity-')));
  git('init', '--quiet', '--initial-branch=main');
  // Git for Windows converts line endings by default and warns about it on every `git add`.
  git('config', 'core.autocrlf', 'false');
  writeFileSync(path.join(workingCopy, '.git/info/exclude'), '/.internal\n');
  mkdirSync(path.join(workingCopy, 'scripts'));
  cpSync(
    path.join(REPO, 'scripts/check-identity.sh'),
    path.join(workingCopy, 'scripts/check-identity.sh'),
  );
  chmodSync(path.join(workingCopy, 'scripts/check-identity.sh'), 0o755);
  write(PATTERNS, '# invented names\n\nlovelace\nbabbage[0-9]+\n');
});

afterEach(() => {
  rmSync(workingCopy, { recursive: true, force: true });
});

function git(...args: string[]): void {
  const result = spawnSync('git', args, { cwd: workingCopy, encoding: 'utf8' });
  expect(result.stderr).toBe('');
  expect(result.status).toBe(0);
}

function write(relativePath: string, content: string): void {
  const file = path.join(workingCopy, relativePath);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, content);
}

/** Writes the files and stages them, the way they sit in a working copy before a commit. */
function track(files: Record<string, string>): void {
  for (const [relativePath, content] of Object.entries(files)) write(relativePath, content);
  git('add', '--', ...Object.keys(files));
}

function check(env: NodeJS.ProcessEnv = {}): SpawnSyncReturns<string> {
  return spawnSync('bash', ['scripts/check-identity.sh'], {
    cwd: workingCopy,
    env: { ...process.env, ...env },
    encoding: 'utf8',
  });
}

function matchesIn(result: SpawnSyncReturns<string>): string[] {
  return result.stdout.split('\n').filter((line) => /^[^\s].*:\d+$/.test(line));
}

describe('scripts/check-identity.sh', () => {
  it('passes a tree that names nobody', () => {
    track({ 'README.md': '# A recorder\n\nIt records meetings.\n' });

    const result = check();

    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('check-identity: clean');
  });

  it('fails on every line that matches, by path and line, never quoting the text', () => {
    track({
      'README.md': 'Written by\nAda Lovelace.\n',
      'docs/notes.md': 'one\ntwo\nbabbage42 was here\nfour\nlovelace again\n',
    });

    const result = check();

    expect(result.status).toBe(1);
    expect(matchesIn(result)).toEqual(['README.md:2', 'docs/notes.md:3', 'docs/notes.md:5']);
    expect(result.stdout).toContain('3 lines in 2 files');
    expect(result.stdout + result.stderr).not.toMatch(/lovelace|babbage/i);
  });

  it('matches whatever the case', () => {
    track({ 'NOTES.md': 'LOVELACE\n' });

    expect(matchesIn(check())).toEqual(['NOTES.md:1']);
  });

  it('reads the lockfile like any other file', () => {
    track({ 'pnpm-lock.yaml': "lockfileVersion: '9.0'\n  resolution: babbage7\n" });

    expect(matchesIn(check())).toEqual(['pnpm-lock.yaml:2']);
  });

  it('reads a new file before it is staged, but not an ignored one', () => {
    track({ '.gitignore': 'NOTES.local.md\n' });
    write('docs/draft.md', 'by lovelace\n');
    write('NOTES.local.md', 'lovelace keeps the machine notes here\n');

    expect(matchesIn(check())).toEqual(['docs/draft.md:1']);
  });

  it('names a binary file that matches, which has no line to point at', () => {
    track({ 'icon.png': 'PNG\0\0author: lovelace\0' });

    const result = check();

    expect(result.status).toBe(1);
    expect(result.stdout).toContain('\nicon.png (binary)\n');
    expect(result.stdout).toContain('1 lines in 1 files');
  });

  it('reads where a symbolic link points, which git grep does not, unless git ignores it', () => {
    track({ '.gitignore': 'inspiration\n' });
    symlinkSync('/srv/lovelace/tools', path.join(workingCopy, '.tools'));
    symlinkSync('/srv/lovelace/inspiration', path.join(workingCopy, 'inspiration'));
    symlinkSync('README.md', path.join(workingCopy, 'readme-link'));
    git('add', '--', 'readme-link');

    const result = check();

    expect(result.status).toBe(1);
    expect(result.stdout).toContain('\n.tools (symlink)\n');
    expect(result.stdout).toContain('1 lines in 1 files');
  });

  it('never reads the internal folder the working copy links, which git ignores', () => {
    write('.internal/docs/notes.md', 'lovelace keeps the internal notes here\n');
    track({ 'README.md': 'clean\n' });

    expect(check().status).toBe(0);
  });

  it('reads a folder named private/ like any other: nothing private is tracked any more', () => {
    track({ 'private/plan.md': 'lovelace\n', 'README.md': 'clean\n' });

    expect(matchesIn(check())).toEqual(['private/plan.md:1']);
  });

  it('does not let a blank or comment line in the patterns match every line', () => {
    write(PATTERNS, '\n# a comment\n   \nlovelace\n');
    track({ 'README.md': 'clean\n# a heading\n' });

    expect(check().status).toBe(0);
  });

  it('reads the patterns from IDENTITY_PATTERNS when it is set', () => {
    const elsewhere = mkdtempSync(path.join(tmpdir(), 'zen-recorder-patterns-'));
    writeFileSync(path.join(elsewhere, 'patterns.txt'), 'hopper\n');
    track({ 'README.md': 'Grace Hopper\n', 'NOTES.md': 'lovelace\n' });

    const result = check({ IDENTITY_PATTERNS: path.join(elsewhere, 'patterns.txt') });
    rmSync(elsewhere, { recursive: true });

    expect(matchesIn(result)).toEqual(['README.md:1']);
  });

  it('refuses to pass without a patterns file, rather than check nothing', () => {
    rmSync(path.join(workingCopy, PATTERNS));
    track({ 'README.md': 'clean\n' });

    const result = check();

    expect(result.status).toBe(2);
    expect(result.stderr).toContain(PATTERNS);
  });

  it('refuses to pass on a patterns file without a pattern', () => {
    write(PATTERNS, '# nothing yet\n\n');
    track({ 'README.md': 'clean\n' });

    const result = check();

    expect(result.status).toBe(2);
    expect(result.stderr).toContain('no pattern');
  });

  it('works from any folder of the working copy', () => {
    track({ 'docs/notes.md': 'lovelace\n' });

    const result = spawnSync('bash', ['../scripts/check-identity.sh'], {
      cwd: path.join(workingCopy, 'docs'),
      encoding: 'utf8',
    });

    expect(matchesIn(result)).toEqual(['docs/notes.md:1']);
  });
});
