/**
 * The shell of every `run` step of `.github/workflows/ci.yml` (`defaults.run.shell`). It runs the
 * step's script the way GitHub's own bash shell does (`bash --noprofile --norc -eo pipefail`),
 * passes its output through, and records for the job's report (`write-report.ts`) the step's id,
 * the script, its exit status, when it started and ended, and what it printed.
 *
 * It runs on Node.js alone, before any package is installed: the step that installs them runs
 * through it too. So it imports only Node.js's own modules, and Node.js runs it as TypeScript
 * without tsx.
 *
 * Usage, by GitHub, with the file it wrote the step's script to: node scripts/ci/run-step.ts <file>
 * Env: GITHUB_ACTION (the step's id, set by GitHub), CI_REPORT_DIR (where the records go, by
 * default $RUNNER_TEMP/ci-report). Each step leaves `steps/<id>.json` and `steps/<id>.log` there.
 */
import { spawn } from 'node:child_process';
import { createWriteStream, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { constants } from 'node:os';
import path from 'node:path';

const script = process.argv[2];
const step = process.env['GITHUB_ACTION'];
const runnerTemp = process.env['RUNNER_TEMP'];
const reportDir =
  process.env['CI_REPORT_DIR'] ?? (runnerTemp ? path.join(runnerTemp, 'ci-report') : undefined);
if (!script || !step || !reportDir) {
  console.error('Usage: GITHUB_ACTION=<step id> node scripts/ci/run-step.ts <script file>');
  console.error('(CI_REPORT_DIR or RUNNER_TEMP names where the records go)');
  process.exit(2);
}

const records = path.join(reportDir, 'steps');
mkdirSync(records, { recursive: true });
const log = createWriteStream(path.join(records, `${step}.log`));
const startedAt = Date.now();
const child = spawn('bash', ['--noprofile', '--norc', '-eo', 'pipefail', script], {
  stdio: ['inherit', 'pipe', 'pipe'],
});
child.stdout.on('data', (chunk: Buffer) => {
  process.stdout.write(chunk);
  log.write(chunk);
});
child.stderr.on('data', (chunk: Buffer) => {
  process.stderr.write(chunk);
  log.write(chunk);
});
// A cancelled run signals this process; the script has to hear it, and its end is still recorded.
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => child.kill(signal));
}
child.on('close', (code, signal) => {
  const exitCode = code ?? 128 + (signal ? constants.signals[signal] : 0);
  const record = {
    step,
    command: readFileSync(script, 'utf8'),
    exitCode,
    startedAt,
    endedAt: Date.now(),
  };
  writeFileSync(path.join(records, `${step}.json`), `${JSON.stringify(record)}\n`);
  log.end(() => {
    process.exitCode = exitCode;
  });
});
