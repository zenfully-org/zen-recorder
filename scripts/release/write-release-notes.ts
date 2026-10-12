/**
 * Writes the notes of a version's GitHub Release (`buildReleaseNotes`): its CHANGELOG.md section
 * (`scripts/release-notes.sh`), then the install steps of `.github/release-notes-footer.md`. With
 * `--unsigned-xpi`, the notes of its pre-release instead: the notice of
 * `.github/pre-release-notice.md` first, with the version and that XPI's SHA-256. The files are
 * read from the repository this script is in, wherever it runs.
 *
 * Usage: tsx scripts/release/write-release-notes.ts --version <x.y.z> --out <file>
 *          [--unsigned-xpi <file>]
 *
 * Exit status: 0 written, 1 no changelog section for the version or a notice it refuses, 2 usage
 * or a file it cannot read.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { buildReleaseNotes } from './build-release-notes';

const REPO = path.resolve(import.meta.dirname, '../..');
const USAGE =
  'usage: write-release-notes.ts --version <x.y.z> --out <file> [--unsigned-xpi <file>]';

function fail(message: string, status: 1 | 2): never {
  console.error(`write-release-notes: ${message}`);
  process.exit(status);
}

function read(file: string): Buffer {
  try {
    return readFileSync(file);
  } catch {
    return fail(`cannot read ${file}`, 2);
  }
}

function parseOptions() {
  try {
    const { values } = parseArgs({
      options: {
        version: { type: 'string' },
        out: { type: 'string' },
        'unsigned-xpi': { type: 'string' },
      },
    });
    const { version, out } = values;
    if (!version || !out) return fail(USAGE, 2);
    return { version, out, unsignedXpi: values['unsigned-xpi'] };
  } catch {
    return fail(USAGE, 2);
  }
}

/** The version's changelog section; the script says on stderr why there is none. */
function readChanges(version: string): string {
  try {
    return execFileSync('bash', [path.join(REPO, 'scripts/release-notes.sh'), version], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'inherit'],
    });
  } catch {
    return fail(`no release notes for ${version} (see above)`, 1);
  }
}

const options = parseOptions();
const changes = readChanges(options.version);
const footer = read(path.join(REPO, '.github/release-notes-footer.md')).toString();
const preRelease =
  options.unsignedXpi === undefined
    ? undefined
    : {
        notice: read(path.join(REPO, '.github/pre-release-notice.md')).toString(),
        version: options.version,
        sha256: createHash('sha256').update(read(options.unsignedXpi)).digest('hex'),
      };

try {
  writeFileSync(options.out, buildReleaseNotes({ changes, footer, preRelease }));
} catch (error) {
  fail(error instanceof Error ? error.message : String(error), 1);
}
const notice =
  preRelease === undefined
    ? ''
    : `, opening with the pre-release notice (SHA-256 ${preRelease.sha256})`;
console.log(`${options.out}: the notes of ${options.version}${notice}`);
