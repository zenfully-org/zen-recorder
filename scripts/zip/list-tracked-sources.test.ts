// @vitest-environment node
/**
 * `listTrackedSources` in throwaway git repositories. Its patterns are globbed the way wxt globs
 * them when it writes the sources zip, so what a test sees is what would reach the zip.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { glob } from 'tinyglobby';
import { listTrackedSources } from './list-tracked-sources';

const REPO = path.resolve(import.meta.dirname, '../..');

let workingCopy = '';

beforeEach(() => {
  workingCopy = realpathSync(mkdtempSync(path.join(tmpdir(), 'zen-recorder-sources-')));
  git('init', '--quiet', '--initial-branch=main');
});

afterEach(() => {
  rmSync(workingCopy, { recursive: true, force: true });
});

function git(...args: string[]): void {
  const result = spawnSync('git', args, { cwd: workingCopy, encoding: 'utf8' });
  expect(result.stderr).toBe('');
  expect(result.status).toBe(0);
}

function write(files: string[]): void {
  for (const relativePath of files) {
    const file = path.join(workingCopy, relativePath);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, '');
  }
}

/** Writes the files and stages them; names are taken literally, not as git pathspecs. */
function track(files: string[]): void {
  write(files);
  git('--literal-pathspecs', 'add', '--', ...files);
}

/** The files a sources zip built from the patterns would hold. */
async function zipped(dot: boolean): Promise<string[]> {
  const patterns = listTrackedSources({ cwd: workingCopy, dot });
  const files = await glob(patterns, { cwd: workingCopy, onlyFiles: true, dot });
  return files.sort();
}

describe('listTrackedSources', () => {
  it('matches what git tracks and nothing else, whether git ignores it or not', async () => {
    track(['package.json', 'src/main.ts']);
    write(['notes.txt', 'out/recording.webm', 'scratch/try.ts']);
    mkdirSync(path.join(workingCopy, '.git/info'), { recursive: true });
    writeFileSync(path.join(workingCopy, '.git/info/exclude'), '/scratch/\n');

    expect(await zipped(false)).toEqual(['package.json', 'src/main.ts']);
  });

  it('matches a name with glob characters as that one file', async () => {
    const tracked = [
      '!e.ts',
      'src/@(h).ts',
      'src/a[1].ts',
      'src/b(2).ts',
      'src/f+(g).ts',
      'src/{c,d}.ts',
    ];
    track(tracked);
    // What those names match as patterns: everything but e.ts, extglobs, a character class, a
    // group and a brace list.
    write([
      'e.ts',
      'other.ts',
      'src/h.ts',
      'src/a1.ts',
      'src/b2.ts',
      'src/fg.ts',
      'src/c.ts',
      'src/d.ts',
    ]);

    expect(await zipped(false)).toEqual(tracked);
  });

  it.each([
    {
      name: 'leaves hidden files and folders out, as the sources zip does by default',
      dot: false,
      expected: ['src/main.ts'],
    },
    {
      name: 'keeps hidden files and folders when the sources zip takes them',
      dot: true,
      expected: ['.github/ci.yml', '.gitignore', 'src/.env.example', 'src/main.ts'],
    },
  ])('$name', async ({ dot, expected }) => {
    track(['.gitignore', '.github/ci.yml', 'src/.env.example', 'src/main.ts']);

    expect(await zipped(dot)).toEqual(expected);
  });

  it('throws outside a git working copy instead of guessing what to zip', () => {
    rmSync(path.join(workingCopy, '.git'), { recursive: true });

    expect(() => listTrackedSources({ cwd: workingCopy, dot: false })).toThrow(
      /not a git repository/,
    );
  });

  it('escapes for the same tinyglobby that wxt zips with', () => {
    const wxt = createRequire(realpathSync(path.join(REPO, 'node_modules/wxt/package.json')));
    const ours = createRequire(path.join(REPO, 'package.json'));

    expect(realpathSync(ours.resolve('tinyglobby'))).toBe(realpathSync(wxt.resolve('tinyglobby')));
  });
});
