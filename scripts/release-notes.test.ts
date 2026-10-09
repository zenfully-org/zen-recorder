// @vitest-environment node
/**
 * `scripts/release-notes.sh` and the `CHANGELOG.md` it reads. The script runs on the repository's
 * changelog and on invented ones in a throwaway folder. The shape tests read the real changelog, so
 * a release that forgets a heading, a date or the version in `package.json` fails here, before the
 * release workflow publishes notes from it.
 */
import { type SpawnSyncReturns, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { z } from 'zod';

const REPO = path.resolve(import.meta.dirname, '..');
const SCRIPT = path.join(REPO, 'scripts/release-notes.sh');
const CHANGELOG = path.join(REPO, 'CHANGELOG.md');

// Keep a Changelog's groups that the project uses, in the order Keep a Changelog gives them.
const GROUPS = ['### Added', '### Changed', '### Removed', '### Fixed'];
const RELEASE_HEADING = /^## (\d+)\.(\d+)\.(\d+) - (\d{4}-\d{2}-\d{2})$/;

const INVENTED = [
  '# Changelog',
  '',
  'What changed.',
  '',
  '## Unreleased',
  '',
  '### Fixed',
  '',
  '- A fix not released yet.',
  '',
  '## 1.10.0 - 2026-12-01',
  '',
  '### Added',
  '',
  '- A feature.',
  '  Its second line.',
  '',
  '### Fixed',
  '',
  '- A fix.',
  '',
  '',
  '## 1.1.0 - 2026-11-01',
  '',
  '### Changed',
  '',
  '- A change in 1.1.0.',
  '',
  '## 1.0.0 - 2026-10-01',
  '',
  '### Added',
  '',
  '- The first release.',
];

let folder = '';

beforeEach(() => {
  folder = realpathSync(mkdtempSync(path.join(tmpdir(), 'zen-recorder-release-notes-')));
});

afterEach(() => {
  rmSync(folder, { recursive: true, force: true });
});

function run(args: string[], cwd = REPO): SpawnSyncReturns<string> {
  return spawnSync('bash', [SCRIPT, ...args], { cwd, encoding: 'utf8' });
}

/** Writes an invented changelog into the throwaway folder and returns its path. */
function changelog(lines: string[] = INVENTED): string {
  const file = path.join(folder, 'CHANGELOG.md');
  writeFileSync(file, `${lines.join('\n')}\n`);
  return file;
}

/** The repository changelog split at its `## ` headings: each heading with the lines under it. */
function sections(): { heading: string; lines: string[] }[] {
  const found: { heading: string; lines: string[] }[] = [];
  for (const line of readFileSync(CHANGELOG, 'utf8').split('\n')) {
    if (line.startsWith('## ')) found.push({ heading: line, lines: [] });
    else found.at(-1)?.lines.push(line);
  }
  return found;
}

/** Positive when version a is newer than version b. */
function compareVersions(a: number[], b: number[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const difference = (a[i] ?? 0) - (b[i] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

function releases(): { heading: string; version: number[]; date: string; lines: string[] }[] {
  return sections()
    .slice(1)
    .map(({ heading, lines }) => {
      const match = heading.match(RELEASE_HEADING);
      if (match === null) throw new Error(`not a release heading: ${heading}`);
      const [, major = '', minor = '', patch = '', date = ''] = match;
      return { heading, version: [major, minor, patch].map(Number), date, lines };
    });
}

describe('scripts/release-notes.sh', () => {
  it('prints the 0.3.0 section of the repository changelog, and nothing of the sections around it', () => {
    const result = run(['0.3.0']);

    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/^### /);
    // Right below the heading and a blank line, and followed by a blank line and 0.2.0's heading.
    expect(readFileSync(CHANGELOG, 'utf8')).toContain(
      `\n## 0.3.0 - 2026-10-01\n\n${result.stdout}\n## 0.2.0 - `,
    );
  });

  it('finds the repository changelog whichever folder it runs in', () => {
    const result = run(['0.3.0'], folder);

    expect(result.status).toBe(0);
    expect(result.stdout).toBe(run(['0.3.0']).stdout);
  });

  it('prints the lines of the section with its groups, without its heading or the blank lines around it', () => {
    const result = run(['1.10.0', changelog()]);

    expect(result.status).toBe(0);
    expect(result.stdout).toBe(
      '### Added\n\n- A feature.\n  Its second line.\n\n### Fixed\n\n- A fix.\n',
    );
  });

  it('prints the last section up to the end of the file', () => {
    expect(run(['1.0.0', changelog()]).stdout).toBe('### Added\n\n- The first release.\n');
  });

  it('prints what the next release holds so far for Unreleased', () => {
    expect(run(['Unreleased', changelog()]).stdout).toBe(
      '### Fixed\n\n- A fix not released yet.\n',
    );
  });

  it('matches the version exactly, so 1.1.0 is not the 1.10.0 above it', () => {
    expect(run(['1.1.0', changelog()]).stdout).toBe('### Changed\n\n- A change in 1.1.0.\n');
  });

  it('fails on a version the repository changelog has no section for, and prints nothing', () => {
    const result = run(['0.0.1']);

    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
    // bash names the file as it sees it: `/d/…` under Git Bash on Windows, so only its name is compared.
    expect(result.stderr).toMatch(/release-notes: no section for 0\.0\.1 in .*CHANGELOG\.md/);
  });

  it.each([
    ['the start of a version', '1.1'],
    ['a version with more parts', '1.0.0.1'],
    ['a version with a tag prefix', 'v1.0.0'],
    ['dots taken as any character', '1x10x0'],
    ['a date', '2026-10-01'],
  ])('fails on %s, and prints nothing', (_case, version) => {
    const file = changelog();

    const result = run([version, file]);

    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain(`release-notes: no section for ${version} in ${file}`);
  });

  it('fails on a section without a line, so a release never goes out with empty notes', () => {
    const file = changelog([
      '# Changelog',
      '',
      '## 2.0.0 - 2027-01-01',
      '',
      '  ',
      '',
      '## 1.0.0 - 2026-10-01',
      '',
      '- The first release.',
    ]);

    const result = run(['2.0.0', file]);

    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain(`release-notes: the section for 2.0.0 in ${file} is empty`);
  });

  it('fails when the changelog cannot be read', () => {
    const missing = path.join(folder, 'missing.md');

    const result = run(['1.0.0', missing]);

    expect(result.status).toBe(2);
    expect(result.stderr).toContain(`release-notes: cannot read ${missing}`);
  });

  it.each([
    ['no version', []],
    ['an empty version', ['']],
    ['three arguments', ['1.0.0', 'CHANGELOG.md', 'more']],
  ])('refuses %s', (_case, args) => {
    const result = run(args);

    expect(result.status).toBe(2);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('usage:');
  });
});

describe('CHANGELOG.md', () => {
  it('starts with Unreleased, then one section per release with its date, newest first', () => {
    const released = releases();

    expect(sections()[0]?.heading).toBe('## Unreleased');
    expect(released.map((release) => release.heading)).toEqual(
      expect.arrayContaining(['## 0.3.0 - 2026-10-01', '## 0.2.0 - 2026-09-07']),
    );
    released.slice(1).forEach((older, i) => {
      const newer = released[i];
      const order = `${newer?.heading} above ${older.heading}`;
      expect(compareVersions(newer?.version ?? [], older.version), order).toBeGreaterThan(0);
      expect((newer?.date ?? '') >= older.date, order).toBe(true);
    });
  });

  it('keeps no entry under Unreleased: the next release waits in changes/, one file per entry', () => {
    const lines = sections()[0]?.lines ?? [];

    expect(lines.filter((line) => line.startsWith('### ') || line.startsWith('- '))).toEqual([]);
    expect(lines.join('\n')).toContain('[`changes/`](changes/)');
  });

  it('puts every line of a release under Added, Changed, Removed or Fixed, in that order, each group once', () => {
    for (const { heading, lines } of releases()) {
      const groups = lines.filter((line) => line.startsWith('### '));
      const order = groups.map((group) => GROUPS.indexOf(group));
      const firstGroup = lines.findIndex((line) => line.startsWith('### '));
      const outside = firstGroup === -1 ? lines : lines.slice(0, firstGroup);

      expect(outside.join('').trim(), `${heading}: a line outside a group`).toBe('');
      for (const group of groups) expect(GROUPS, heading).toContain(group);
      expect(
        order.every((index, i) => i === 0 || index > (order[i - 1] ?? -1)),
        `${heading}: ${groups.join(', ')}`,
      ).toBe(true);
    }
  });

  it('has at least one entry in every release', () => {
    for (const { heading, lines } of releases()) {
      expect(
        lines.some((line) => line.startsWith('- ')),
        heading,
      ).toBe(true);
    }
  });

  it('names as its newest release the version in package.json, so a release changes both', () => {
    const { version } = z
      .object({ version: z.string() })
      .parse(JSON.parse(readFileSync(path.join(REPO, 'package.json'), 'utf8')));

    expect(releases()[0]?.heading).toMatch(new RegExp(`^## ${version.replaceAll('.', '\\.')} - `));
  });
});
