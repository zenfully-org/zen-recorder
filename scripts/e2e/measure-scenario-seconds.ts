/**
 * Measures how long each end-to-end scenario takes on CI, and writes the table `E2E_SHARD` splits a
 * service's run by (`scripts/e2e/scenario-seconds.json`): per service, the median of the
 * `✓ <scenario> (<n> s)` lines in the logs of the end-to-end jobs of the CI workflow's last
 * successful runs (`summarizeScenarioTimes`). Run it when the shards of a service no longer end
 * close together (each job's time is on the run's page), or after a change that makes scenarios
 * much faster or slower, and commit the table. A scenario the table does not know yet counts as a
 * typical one of its service, so a new scenario needs no new row.
 *
 * Usage: `pnpm e2e:seconds [--runs <n>] [--branch <name>]`: the last 20 successful runs by default,
 * of any branch; `--branch` takes only the runs of one (a pull request's, to measure its change).
 * Needs the GitHub CLI (`gh`), logged in; it reads the repository of the working copy's remote.
 */
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { z } from 'zod';
import { summarizeScenarioTimes } from './summarize-scenario-times';

const TABLE = path.join(import.meta.dirname, 'scenario-seconds.json');
/** An end-to-end job, `E2E (<service>, <k> of <n>)`, with its caller's name first in a release. */
const E2E_JOB = /^(?:.+ \/ )?E2E \(([a-z]+), \d+ of \d+\)$/;

const runsSchema = z.array(z.object({ databaseId: z.number() }));
const jobsSchema = z.object({
  jobs: z.array(z.object({ id: z.number(), name: z.string(), conclusion: z.string().nullable() })),
});

const gh = (args: string[]): string =>
  execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });

/**
 * A read of the runs' jobs and logs, or null when it fails: one sample fewer only widens the
 * spread, and the medians stand without it.
 */
function readOrSkip(args: string[], what: string): string | null {
  try {
    return gh(args);
  } catch (error) {
    console.warn(`left out ${what}, which could not be read: ${error}`);
    return null;
  }
}

function main(): void {
  const { values } = parseArgs({
    options: { runs: { type: 'string', default: '20' }, branch: { type: 'string' } },
  });
  const list = ['run', 'list', '--workflow', 'ci.yml', '--status', 'success'];
  const branch = values.branch === undefined ? [] : ['--branch', values.branch];
  const runs = runsSchema.parse(
    JSON.parse(gh([...list, ...branch, '--limit', values.runs, '--json', 'databaseId'])),
  );
  const logs: { provider: string; text: string }[] = [];
  for (const { databaseId } of runs) {
    const api = `repos/{owner}/{repo}/actions/runs/${databaseId}/jobs?per_page=100`;
    const answer = readOrSkip(['api', api], `run ${databaseId}`);
    const jobs = answer === null ? [] : jobsSchema.parse(JSON.parse(answer)).jobs;
    for (const job of jobs) {
      const provider = E2E_JOB.exec(job.name)?.[1];
      if (provider === undefined || job.conclusion !== 'success') continue;
      const logApi = `repos/{owner}/{repo}/actions/jobs/${job.id}/logs`;
      const text = readOrSkip(['api', logApi], `the log of job ${job.id} (${job.name})`);
      if (text !== null) logs.push({ provider, text });
    }
    console.log(`run ${databaseId}: ${logs.length} end-to-end job logs so far`);
  }
  const seconds = summarizeScenarioTimes(logs);
  const day = new Date().toISOString().slice(0, 10);
  const of = `${runs.length} successful CI run${runs.length === 1 ? '' : 's'}`;
  const branchOf = values.branch === undefined ? '' : ` of ${values.branch}`;
  const measured = `${day}: the median of ${logs.length} end-to-end job logs from ${of}${branchOf}`;
  writeFileSync(TABLE, `${JSON.stringify({ measured, seconds }, null, 2)}\n`);
  for (const [provider, scenarios] of Object.entries(seconds)) {
    const total = Object.values(scenarios).reduce((sum, value) => sum + value, 0);
    console.log(`${provider}: ${Object.keys(scenarios).length} scenarios, ${total} s in all`);
  }
  console.log(`wrote ${path.relative(process.cwd(), TABLE)}`);
}

main();
