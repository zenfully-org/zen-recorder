/**
 * The changelog entries that wait for the next release, one file each in `changes/<group>/`
 * (CONTRIBUTING.md, "The changelog and releases").
 *
 * Usage: pnpm changelog                          prints the next release as its section will read
 *        pnpm changelog --release <x.y.z> [--date <YYYY-MM-DD>]
 *                                                writes that section into CHANGELOG.md, below
 *                                                `## Unreleased`, deletes the entry files, and
 *                                                names the release in the meeting notes format's
 *                                                changelog when it is the first to write the
 *                                                format version this build writes
 *        --root <dir>                            another repository (default: this one)
 * Exit status: 0 done, 1 nothing to release, a malformed entry or a format changelog without the
 * version's line, 2 usage.
 */
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { MEETING_NOTES_VERSION } from '../src/lib/notes/build-meeting-notes';
import { insertReleaseSection } from './changelog/insert-release-section';
import { nameFormatRelease } from './changelog/name-format-release';
import { readChangeEntries } from './changelog/read-change-entries';
import { renderChangeGroups } from './changelog/render-change-groups';

const FORMAT_DOC = 'docs/meeting-notes-format.md';

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
  const formatFile = path.join(root, FORMAT_DOC);
  const format = readFileSync(formatFile, 'utf8');
  // Both files are worked out before either is written, so a refusal changes nothing.
  const changelog = insertReleaseSection(
    readFileSync(file, 'utf8'),
    release,
    date,
    renderChangeGroups(entries),
  );
  const named = nameFormatRelease(format, MEETING_NOTES_VERSION, release);
  writeFileSync(file, changelog);
  if (named !== format) writeFileSync(formatFile, named);
  for (const entry of entries) rmSync(path.join(root, entry.file));
  const count = `${entries.length} ${entries.length === 1 ? 'entry' : 'entries'}`;
  console.log(
    `CHANGELOG.md: ${release} - ${date} with ${count}; deleted ${entries.map((entry) => entry.file).join(', ')}`,
  );
  if (named !== format) {
    // The example and the golden file name their generator in test code, changed by hand.
    console.log(
      `${FORMAT_DOC}: format ${MEETING_NOTES_VERSION} is first written by Zen Recorder ${release}; name ${release} as the generator of the format's example and golden file in src/test/notes/ (a test fails until they do)`,
    );
  }
}

try {
  main();
} catch (error) {
  console.error(`changelog: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
