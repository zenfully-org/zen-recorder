/**
 * Turns a version's unsigned pre-release into the release, once the signed XPI is attached to it
 * (`planReleaseSwitch`): deletes the unsigned XPI, then publishes it with the notes given (the
 * ones without the pre-release notice), its plain title, not a pre-release, and marked latest
 * unless a newer version is out. On a release that is finished already it changes nothing. The
 * release workflow runs it after it checked the signed XPI, before it publishes the update
 * manifest.
 *
 * Usage: tsx scripts/release/switch-to-signed-release.ts --version <x.y.z> --notes <file>
 *          [--dry-run]
 * Env: GH_REPO (owner/name) and GH_TOKEN, for `gh`. `--dry-run` prints the `gh` commands instead
 * of running them.
 *
 * Exit status: 0 switched (or nothing to do), 1 refused (an error annotation says why), 2 usage
 * or a `gh` command that failed.
 */
import { execFileSync } from 'node:child_process';
import { parseArgs } from 'node:util';
import { escapeCommandData } from '../ci/escape-command-data';
import { parseReleaseList } from './parse-release-list';
import { planReleaseSwitch } from './plan-release-switch';

const USAGE = 'usage: switch-to-signed-release.ts --version <x.y.z> --notes <file> [--dry-run]';

function fail(message: string, status: 1 | 2): never {
  const line = `switch-to-signed-release: ${message}`;
  console.log(`::error::${escapeCommandData(line)}`);
  process.exit(status);
}

function parseOptions() {
  try {
    const { values } = parseArgs({
      options: {
        version: { type: 'string' },
        notes: { type: 'string' },
        'dry-run': { type: 'boolean', default: false },
      },
    });
    const { version, notes } = values;
    if (!version || !notes) return fail(USAGE, 2);
    return { version, notes, dryRun: values['dry-run'] };
  } catch {
    return fail(USAGE, 2);
  }
}

function gh(args: string[]): string {
  try {
    return execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
  } catch {
    return fail(`gh ${args.join(' ')} failed (see above)`, 2);
  }
}

const options = parseOptions();
const tag = `v${options.version}`;
// One page holds every release for years: the project releases every few weeks.
const releases = (() => {
  try {
    return parseReleaseList(JSON.parse(gh(['api', 'repos/{owner}/{repo}/releases?per_page=100'])));
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error), 2);
  }
})();
const plan = planReleaseSwitch({ version: options.version, releases });
if (!plan.ok) fail(plan.problem, 1);

const commands = [
  ...plan.deleteAssets.map((asset) => ['release', 'delete-asset', tag, asset, '--yes']),
  ...(plan.publish === undefined
    ? []
    : [
        [
          'release',
          'edit',
          tag,
          '--title',
          plan.publish.title,
          '--notes-file',
          options.notes,
          '--draft=false',
          '--prerelease=false',
          `--latest=${plan.publish.latest}`,
        ],
      ]),
];
const verb = options.dryRun ? 'would run' : 'running';
for (const command of commands) {
  console.log(`${verb}: gh ${command.join(' ')}`);
  if (!options.dryRun) gh(command);
}
if (plan.publish === undefined) {
  console.log(`switch-to-signed-release: ${tag} is a release already: nothing to publish`);
} else {
  const is = options.dryRun ? 'would be' : 'is';
  const latest = plan.publish.latest ? ', marked latest' : ', not the latest: a newer one is out';
  console.log(`switch-to-signed-release: ${tag} ${is} the release${latest}`);
}
