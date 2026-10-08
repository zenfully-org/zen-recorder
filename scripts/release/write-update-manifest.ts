/**
 * Writes the update manifest (`updates.json`) for a release: the published manifest plus the
 * entry of the given XPI, with the XPI's SHA-256 and the minimum Firefox of its own manifest.
 * The XPI is checked first (`readReleaseXpi`): the release's version, the build of the channel
 * addons.mozilla.org signs it on (`unlisted`: the self-distributed build, which names this update
 * manifest; `listed`: the build that names none), and Mozilla's signature unless `--unsigned` (a
 * dry run's preview). A listed release gets its entry too: a copy installed from a GitHub Release
 * before the listing updates to it, and from then on updates from addons.mozilla.org.
 * Needs `unzip` on the PATH.
 *
 * Usage: tsx scripts/release/write-update-manifest.ts --channel <listed|unlisted> --xpi <file>
 *          --version <version> --update-link <https URL of the XPI> --out <file>
 *          [--previous <published updates.json>] [--unsigned]
 *
 * Exit status: 0 written, 1 the XPI or the published manifest was refused, 2 usage or a file it
 * cannot read.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { z } from 'zod';
import { buildUpdateManifest } from './build-update-manifest';
import { readReleaseXpi } from './read-release-xpi';

const USAGE =
  'usage: write-update-manifest.ts --channel <listed|unlisted> --xpi <file> --version <version> ' +
  '--update-link <url> --out <file> [--previous <file>] [--unsigned]';

const AmoChannel = z.enum(['listed', 'unlisted']);

function fail(message: string, status: 1 | 2): never {
  console.error(`write-update-manifest: ${message}`);
  process.exit(status);
}

function read(file: string): Buffer {
  try {
    return readFileSync(file);
  } catch {
    return fail(`cannot read ${file}`, 2);
  }
}

/** The parsed JSON, or the text itself when it is not JSON, for the parser to refuse. */
function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function parseOptions() {
  try {
    const { values } = parseArgs({
      options: {
        channel: { type: 'string' },
        xpi: { type: 'string' },
        version: { type: 'string' },
        'update-link': { type: 'string' },
        out: { type: 'string' },
        previous: { type: 'string' },
        unsigned: { type: 'boolean', default: false },
      },
    });
    const { xpi, version, 'update-link': updateLink, out } = values;
    if (!xpi || !version || !updateLink || !out) return fail(USAGE, 2);
    const channel = AmoChannel.safeParse(values.channel).data;
    if (channel === undefined) return fail(USAGE, 2);
    return { ...values, channel, xpi, version, updateLink, out };
  } catch {
    return fail(USAGE, 2);
  }
}

/** What `unzip` prints, or nothing when the file is no zip or lacks the entry. */
function unzip(args: string[]): string {
  try {
    return execFileSync('unzip', args, { stdio: ['ignore', 'pipe', 'ignore'] }).toString();
  } catch {
    return '';
  }
}

const options = parseOptions();
const xpi = read(options.xpi);

try {
  const release = readReleaseXpi({
    manifest: parseJson(unzip(['-p', options.xpi, 'manifest.json'])),
    entries: unzip(['-Z1', options.xpi]).split('\n'),
    version: options.version,
    signed: !options.unsigned,
    channel: options.channel,
  });
  const previous =
    options.previous === undefined ? undefined : parseJson(read(options.previous).toString());
  const manifest = buildUpdateManifest(previous, {
    ...release,
    updateLink: options.updateLink,
    sha256: createHash('sha256').update(xpi).digest('hex'),
  });
  writeFileSync(options.out, `${JSON.stringify(manifest, null, 2)}\n`);
  const versions = manifest.addons[release.id]?.updates.map((update) => update.version) ?? [];
  console.log(`${options.out}: ${release.id} ${versions.join(', ')}`);
} catch (error) {
  fail(error instanceof Error ? error.message : String(error), 1);
}
