// @vitest-environment node
/**
 * `pnpm changelog` (scripts/changelog.ts) on an invented repository in a throwaway folder, and the
 * repository's own pending entries, which every pull request that changes something the person
 * recording notices adds to.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { readChangeEntries } from './changelog/read-change-entries';

const REPO = path.resolve(import.meta.dirname, '..');
const NOTE = 'The entries of the next release wait in `changes/`.';
const CHANGELOG = `# Changelog\n\n## Unreleased\n\n${NOTE}\n\n## 0.3.0 - 2026-10-01\n\n### Added\n\n- An old feature.\n`;

let root = '';

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'zen-recorder-changelog-'));
  writeFileSync(path.join(root, 'CHANGELOG.md'), CHANGELOG);
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function write(file: string, text: string): void {
  mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
  writeFileSync(path.join(root, file), text);
}

function changelog(...args: string[]) {
  return spawnSync(
    process.execPath,
    ['--import', 'tsx', 'scripts/changelog.ts', '--root', root, ...args],
    { cwd: REPO, encoding: 'utf8' },
  );
}

describe('pnpm changelog', () => {
  it('prints the next release as its section will read', () => {
    write('changes/fixed/72.md', 'A fix. (#72)\n');
    write('changes/added/9.md', 'A feature. (#9)\n');

    const run = changelog();

    expect(run.stderr).toBe('');
    expect(run.status).toBe(0);
    expect(run.stdout).toBe('### Added\n\n- A feature. (#9)\n\n### Fixed\n\n- A fix. (#72)\n');
  });

  it('says so when no entry waits', () => {
    const run = changelog();

    expect(run.status).toBe(0);
    expect(run.stdout).toBe('No changelog entry waits in changes/.\n');
  });

  it('writes a release into CHANGELOG.md and deletes the entries it took, never the README', () => {
    write('changes/README.md', 'How to write an entry.\n');
    write('changes/fixed/72.md', 'A fix. (#72)\n');

    const run = changelog('--release', '0.4.0', '--date', '2026-10-09');

    expect(run.stderr).toBe('');
    expect(run.status).toBe(0);
    expect(run.stdout).toBe(
      'CHANGELOG.md: 0.4.0 - 2026-10-09 with 1 entry; deleted changes/fixed/72.md\n',
    );
    expect(readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8')).toBe(
      `# Changelog\n\n## Unreleased\n\n${NOTE}\n\n## 0.4.0 - 2026-10-09\n\n### Fixed\n\n- A fix. (#72)\n\n## 0.3.0 - 2026-10-01\n\n### Added\n\n- An old feature.\n`,
    );
    expect(existsSync(path.join(root, 'changes/fixed/72.md'))).toBe(false);
    expect(existsSync(path.join(root, 'changes/README.md'))).toBe(true);
  });

  it.each([
    [
      'a release without entries',
      ['--release', '0.4.0'],
      1,
      'no changelog entry waits in changes/',
    ],
    ['a version that is not x.y.z', ['--release', 'v0.4'], 2, 'Usage: pnpm changelog'],
    [
      'a date that is not YYYY-MM-DD',
      ['--release', '0.4.0', '--date', '9 Oct'],
      2,
      'Usage: pnpm changelog',
    ],
  ])('refuses %s, and changes nothing', (_, args, status, message) => {
    const run = changelog(...args);

    expect(run.status).toBe(status);
    expect(run.stderr).toContain(message);
    expect(readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8')).toBe(CHANGELOG);
  });
});

describe("the repository's pending entries", () => {
  it('are readable, and one named after an issue or pull request ends with its number', () => {
    for (const entry of readChangeEntries(REPO)) {
      const number = /^(\d+)\.md$/.exec(path.basename(entry.file))?.[1];
      if (number !== undefined)
        expect(entry.text, entry.file).toMatch(new RegExp(`\\(#${number}\\)$`));
    }
  });
});
