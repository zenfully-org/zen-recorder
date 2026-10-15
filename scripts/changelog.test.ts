// @vitest-environment node
/**
 * `pnpm changelog` (scripts/changelog.ts) on an invented repository in a throwaway folder, and the
 * repository's own pending entries, which every pull request that changes something the person
 * recording notices adds to. The invented meeting notes format doc has one changelog line, for the
 * format version this build writes.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { MEETING_NOTES_VERSION } from '../src/lib/notes/build-meeting-notes';
import { readChangeEntries } from './changelog/read-change-entries';
import { PROCESS_BUDGET_MS } from './process-budget';

const REPO = path.resolve(import.meta.dirname, '..');
const NOTE = 'The entries of the next release wait in `changes/`.';
const CHANGELOG = `# Changelog\n\n## Unreleased\n\n${NOTE}\n\n## 0.3.0 - 2026-10-01\n\n### Added\n\n- An old feature.\n`;
const FORMAT_DOC = 'docs/meeting-notes-format.md';
const formatDoc = (firstWriter: string) =>
  `# Meeting notes format\n\n## Changelog\n\n- **${MEETING_NOTES_VERSION}** (${firstWriter}): additions only.\n`;

let root = '';

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'zen-recorder-changelog-'));
  writeFileSync(path.join(root, 'CHANGELOG.md'), CHANGELOG);
  write(FORMAT_DOC, formatDoc('Zen Recorder 0.3.0'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function read(file: string): string {
  return readFileSync(path.join(root, file), 'utf8');
}

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

// Each test starts Node with tsx on the changelog command.
describe('pnpm changelog', { timeout: PROCESS_BUDGET_MS }, () => {
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

  it.each([
    [
      'names itself in the format changelog when it is the first to write the format version',
      'unreleased',
      'Zen Recorder 0.4.0',
      `${FORMAT_DOC}: format ${MEETING_NOTES_VERSION} is first written by Zen Recorder 0.4.0; name 0.4.0 as the generator of the format's example and golden file in src/test/notes/ (a test fails until they do)\n`,
    ],
    [
      'leaves the format changelog alone when an earlier release wrote the format version',
      'Zen Recorder 0.3.0',
      'Zen Recorder 0.3.0',
      '',
    ],
  ])('a release %s', (_, before, after, notice) => {
    write('changes/fixed/72.md', 'A fix. (#72)\n');
    write(FORMAT_DOC, formatDoc(before));

    const run = changelog('--release', '0.4.0', '--date', '2026-10-09');

    expect(run.stderr).toBe('');
    expect(run.status).toBe(0);
    expect(run.stdout).toBe(
      `CHANGELOG.md: 0.4.0 - 2026-10-09 with 1 entry; deleted changes/fixed/72.md\n${notice}`,
    );
    expect(read(FORMAT_DOC)).toBe(formatDoc(after));
  });

  it('refuses a release when the format changelog has no line for the format version, and changes nothing', () => {
    write('changes/fixed/72.md', 'A fix. (#72)\n');
    const doc = '# Meeting notes format\n\n## Changelog\n\n- **0.9** (unreleased): another.\n';
    write(FORMAT_DOC, doc);

    const run = changelog('--release', '0.4.0', '--date', '2026-10-09');

    expect(run.status).toBe(1);
    expect(run.stderr).toContain(`no changelog line for format ${MEETING_NOTES_VERSION}`);
    expect(read('CHANGELOG.md')).toBe(CHANGELOG);
    expect(read(FORMAT_DOC)).toBe(doc);
    expect(existsSync(path.join(root, 'changes/fixed/72.md'))).toBe(true);
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
