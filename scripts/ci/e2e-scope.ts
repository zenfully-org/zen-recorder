/**
 * Decides which meeting services' end-to-end jobs a CI run needs (`decideE2eScope`) and hands the
 * answer to the jobs: `providers` (a JSON list) and `reason` as step outputs, and a line in the
 * job's summary. On a pull request and in the merge queue it lists the changed files with git,
 * from the base commit to the checked-out one, so the checkout needs the history between them.
 *
 * Usage, in .github/workflows/ci.yml: tsx scripts/ci/e2e-scope.ts --providers meet,zoom,teams
 * Env: GITHUB_EVENT_NAME, GITHUB_REF, DEFAULT_BRANCH (the repository's), BASE_SHA (the pull
 * request's or the merge group's base; empty otherwise), FULL ("true" for a full run),
 * GITHUB_OUTPUT and GITHUB_STEP_SUMMARY (set by GitHub).
 */
import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { decideE2eScope } from './decide-e2e-scope';

const { values } = parseArgs({ options: { providers: { type: 'string' } } });
const providers = (values.providers ?? '').split(',').filter((name) => name !== '');
const env = process.env;
if (providers.length === 0 || !env['GITHUB_EVENT_NAME'] || !env['GITHUB_REF']) {
  console.error(
    'usage: e2e-scope.ts --providers <a,b,…> (with GITHUB_EVENT_NAME, GITHUB_REF, DEFAULT_BRANCH, BASE_SHA, FULL)',
  );
  process.exit(2);
}

/** The files changed since the base, or undefined when git cannot say (a shallow checkout). */
function changedFiles(base: string | undefined): string[] | undefined {
  if (!base) return undefined;
  try {
    return execFileSync('git', ['diff', '--name-only', base, 'HEAD'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .split('\n')
      .filter((file) => file !== '');
  } catch {
    return undefined;
  }
}

const scope = decideE2eScope({
  event: env['GITHUB_EVENT_NAME'],
  ref: env['GITHUB_REF'],
  defaultBranch: env['DEFAULT_BRANCH'] ?? 'main',
  full: env['FULL'] === 'true',
  changedFiles: changedFiles(env['BASE_SHA']),
  providers,
});

const ran = scope.providers.length === 0 ? 'none' : scope.providers.join(', ');
console.log(`end-to-end runs: ${ran} (${scope.reason})`);
if (env['GITHUB_OUTPUT']) {
  appendFileSync(
    env['GITHUB_OUTPUT'],
    `providers=${JSON.stringify(scope.providers)}\nreason=${scope.reason}\n`,
  );
}
if (env['GITHUB_STEP_SUMMARY']) {
  appendFileSync(
    env['GITHUB_STEP_SUMMARY'],
    `End-to-end runs: **${ran}**, because ${scope.reason}.\n`,
  );
}
