/**
 * Says whether a release may start from this commit (`judgeReleaseStart`): its version is not
 * tagged yet, and every check main requires passed on it. The "Start a release" workflow runs it
 * with what GitHub's API says, before it creates the tag.
 *
 * Usage: tsx scripts/release/check-release-start.ts --version <x.y.z> --tag-exists <true|false>
 *          --required <file: one required check per line> --check-runs <file: the JSON of
 *          GET repos/<repo>/commits/<sha>/check-runs>
 *
 * Exit status: 0 it may start (prints the tag), 1 it may not (each reason as an error annotation),
 * 2 usage or a file it cannot read.
 */
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { z } from 'zod';
import { escapeCommandData } from '../ci/escape-command-data';
import { judgeReleaseStart } from './judge-release-start';

const USAGE =
  'usage: check-release-start.ts --version <x.y.z> --tag-exists <true|false> --required <file> ' +
  '--check-runs <file>';

const CheckRuns = z.object({
  check_runs: z.array(
    z.object({ name: z.string(), status: z.string(), conclusion: z.string().nullable() }),
  ),
});

function fail(message: string): never {
  console.error(`check-release-start: ${message}`);
  process.exit(2);
}

function read(file: string): string {
  try {
    return readFileSync(file, 'utf8');
  } catch {
    return fail(`cannot read ${file}`);
  }
}

const { values } = parseArgs({
  options: {
    version: { type: 'string' },
    'tag-exists': { type: 'string' },
    required: { type: 'string' },
    'check-runs': { type: 'string' },
  },
});
const tagExists = values['tag-exists'];
if (tagExists !== 'true' && tagExists !== 'false') fail(USAGE);
if (!values.version || !values.required || !values['check-runs']) fail(USAGE);

function readJson(file: string): unknown {
  try {
    return JSON.parse(read(file));
  } catch {
    return fail(`${file} is not JSON`);
  }
}

const checkRuns = CheckRuns.safeParse(readJson(values['check-runs']));
if (!checkRuns.success) fail(`${values['check-runs']} is not GitHub's list of check runs`);

const verdict = judgeReleaseStart({
  version: values.version,
  tagExists: tagExists === 'true',
  requiredChecks: read(values.required)
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== ''),
  checkRuns: checkRuns.data.check_runs,
});

if (verdict.ok) {
  console.log(verdict.tag);
} else {
  for (const problem of verdict.problems) console.log(`::error::${escapeCommandData(problem)}`);
  process.exitCode = 1;
}
