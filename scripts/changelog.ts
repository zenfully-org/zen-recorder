/**
 * The changelog entries that wait for the next release, one file each in `changes/<group>/`
 * (CONTRIBUTING.md, "The changelog and releases").
 *
 * Usage: pnpm changelog                          prints the next release as its section will read
 *        pnpm changelog --release <x.y.z> [--date <YYYY-MM-DD>]
 *                                                writes that section into CHANGELOG.md, below
 *                                                `## Unreleased`, and deletes the entry files
 *        --root <dir>                            another repository (default: this one)
 * Exit status: 0 done, 1 nothing to release or a malformed entry, 2 usage.
 */
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { insertReleaseSection } from './changelog/insert-release-section';
import { readChangeEntries } from './changelog/read-change-entries';
import { renderChangeGroups } from './changelog/render-change-groups';

const USAGE =
  'Usage: pnpm changelog [--release <x.y.z> [--date <YYYY-MM-DD>]] [--root <dir>] (see the comment at its top)';

function readArguments(): { root: string; release?: string; date: string } {
  const { values } = parseArgs({
    options: { release: { type: 'string' }, date: { type: 'string' }, root: { type: 'string' } },
  });
  const date = values.date ?? new Date().toISOString().slice(0, 10);
  const badVersion = values.release !== undefined && !/^\d+\.\d+\.\d+$/.test(values.release);
  if (badVersion || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    console.error(USAGE);
    process.exit(2);
  }
  const root = values.root ?? path.resolve(import.meta.dirname, '..');
  return { root, date, ...(values.release === undefined ? {} : { release: values.release }) };
}

function main(): void {
  const { root, release, date } = readArguments();
  const entries = readChangeEntries(root);
  if (release === undefined) {
    console.log(
      entries.length === 0 ? 'No changelog entry waits in changes/.' : renderChangeGroups(entries),
    );
    return;
  }
  if (entries.length === 0) throw new Error('no changelog entry waits in changes/');
  const file = path.join(root, 'CHANGELOG.md');
  const changelog = readFileSync(file, 'utf8');
  writeFileSync(file, insertReleaseSection(changelog, release, date, renderChangeGroups(entries)));
  for (const entry of entries) rmSync(path.join(root, entry.file));
  const count = `${entries.length} ${entries.length === 1 ? 'entry' : 'entries'}`;
  console.log(
    `CHANGELOG.md: ${release} - ${date} with ${count}; deleted ${entries.map((entry) => entry.file).join(', ')}`,
  );
}

try {
  main();
} catch (error) {
  console.error(`changelog: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
