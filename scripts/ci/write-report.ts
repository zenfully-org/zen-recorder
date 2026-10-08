/**
 * The last step of every CI job: writes the job's report from what `run-step.ts` recorded. It
 * appends the summary to the run's page ($GITHUB_STEP_SUMMARY), writes `ci-report.json` and the
 * failed steps' logs (`logs/<id>.log`) into `<report dir>/report/` for the artifact
 * `ci-report-<job>`, and prints workflow commands that annotate the errors on their lines. It
 * exits 0 whatever the job's result: the failed step already failed the job.
 *
 * Usage: pnpm exec tsx scripts/ci/write-report.ts --job <key> --name <check name> [--artifact <name>]...
 * Env: STEPS (`toJSON(steps)`), JOB_STATUS (`job.status`), GitHub's run variables, GITHUB_WORKSPACE,
 * GITHUB_STEP_SUMMARY, CI_REPORT_DIR (default $RUNNER_TEMP/ci-report).
 */
import {
  appendFileSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { buildCiReport } from './build-ci-report';
import { findFailures } from './find-failures';
import { formatAnnotations } from './format-annotations';
import { formatJobSummary } from './format-job-summary';
import { parseCiReport } from './parse-ci-report';
import { parseStepsContext } from './parse-steps-context';
import { readRunInfo } from './read-run-info';
import { readStepRecords } from './read-step-records';

const USAGE =
  'Usage: write-report.ts --job <key> --name <check name> [--artifact <name>]... (see the comment at its top)';

function readArguments(): { job: string; name: string; artifacts: string[] } {
  const { values } = parseArgs({
    options: {
      job: { type: 'string' },
      name: { type: 'string' },
      artifact: { type: 'string', multiple: true },
    },
  });
  if (values.job === undefined || values.name === undefined) {
    console.error(USAGE);
    process.exit(2);
  }
  return { job: values.job, name: values.name, artifacts: values.artifact ?? [] };
}

const readIfThere = (file: string): string | null =>
  existsSync(file) ? readFileSync(file, 'utf8') : null;

function main(): void {
  const { job, name, artifacts } = readArguments();
  const env = process.env;
  const base = env['CI_REPORT_DIR'] ?? path.join(env['RUNNER_TEMP'] ?? '.', 'ci-report');
  const records = path.join(base, 'steps');
  const output = path.join(base, 'report');
  const root = env['GITHUB_WORKSPACE'] ?? process.cwd();
  const logOf = (step: string) => readIfThere(path.join(records, `${step}.log`)) ?? '';

  const report = parseCiReport(
    buildCiReport({
      job,
      jobName: name,
      jobStatus: env['JOB_STATUS'] ?? 'failure',
      run: readRunInfo(env),
      context: parseStepsContext(env['STEPS']),
      records: readStepRecords(records),
      failuresOf: (step) =>
        findFailures(logOf(step), {
          root,
          readCoverage: () => readIfThere(path.join(root, '.coverage/coverage-final.json')),
        }),
      artifacts,
    }),
  );

  mkdirSync(path.join(output, 'logs'), { recursive: true });
  writeFileSync(path.join(output, 'ci-report.json'), `${JSON.stringify(report, null, 2)}\n`);
  for (const step of report.steps) {
    if (step.log === null) continue;
    copyFileSync(path.join(records, `${step.id}.log`), path.join(output, step.log));
  }
  const summary = env['GITHUB_STEP_SUMMARY'];
  if (summary) appendFileSync(summary, formatJobSummary(report));
  for (const line of formatAnnotations(report)) console.log(line);
  console.log(`${name}: ${report.status}; report written to ${output}`);
}

main();
