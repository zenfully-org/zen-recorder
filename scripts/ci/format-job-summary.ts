/**
 * The job's summary on the run's page (`$GITHUB_STEP_SUMMARY`), in GitHub's Markdown: how each step
 * ended and what it took, then for the failed step its errors, the command that runs it locally,
 * and where the whole log and the JSON report are.
 */
import type { CiReport, ReportStep, StepFailure } from './types';

/** Enough to start on; ci-report.json holds them all. */
const SHOWN_FAILURES = 20;

const RESULT: Record<ReportStep['status'], string> = {
  passed: '✅ passed',
  failed: '❌ failed',
  skipped: '⏭️ skipped',
  cancelled: '⏹️ cancelled',
};

function heading(report: CiReport): string {
  if (report.status === 'cancelled') return `## ⏹️ ${report.jobName} was cancelled`;
  if (report.status === 'passed') return `## ✅ ${report.jobName} passed`;
  return report.failedStep === null
    ? `## ❌ ${report.jobName} failed`
    : `## ❌ ${report.jobName} failed at \`${report.failedStep}\``;
}

function duration(seconds: number | null): string {
  if (seconds === null) return '';
  const whole = Math.round(seconds);
  return whole < 60 ? `${whole} s` : `${Math.floor(whole / 60)} min ${whole % 60} s`;
}

/** A command's first line as inline code a table cell can hold. */
function codeCell(command: string | null): string {
  if (command === null) return '';
  const lines = command.trim().split('\n');
  const first = lines.length > 1 ? `${lines[0]} …` : (lines[0] ?? '');
  const escaped = first
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('|', '&#124;');
  return `<code>${escaped}</code>`;
}

/** A fenced block whose fence no line of the text can close. */
function fenced(language: string, text: string): string {
  const longest = Math.max(2, ...text.split('\n').map((line) => /^~*/.exec(line)?.[0].length ?? 0));
  const fence = '~'.repeat(longest + 1);
  return `${fence}${language}\n${text}\n${fence}`;
}

function label(failure: StepFailure): string {
  if (failure.tool !== 'e2e') {
    return [failure.rule, failure.test].filter((part) => part !== null).join(' ');
  }
  const provider = failure.provider ?? '';
  if (failure.scenario === null) return `${provider}: before the scenarios`;
  const test = failure.test === null ? '' : ` (${failure.test})`;
  return `${provider}: scenario ${failure.scenario}${test}`;
}

function describeFailure(failure: StepFailure): string {
  const place = [failure.file, failure.line, failure.column]
    .filter((part) => part !== null)
    .join(':');
  const title = [place, label(failure)].filter((part) => part !== '').join('  ');
  if (title === '') return failure.message;
  const message = failure.message
    .split('\n')
    .map((line) => `  ${line}`)
    .join('\n');
  return `${title}\n${message}`;
}

function failedStep(step: ReportStep, report: CiReport): string[] {
  const { id } = report.run;
  if (step.command === null) {
    return [
      `### \`${step.id}\` failed`,
      '',
      `It runs an action, so its output is only in the log: \`gh run view ${id} --log-failed\`.`,
      '',
    ];
  }
  const count = step.failures.length;
  const shown = step.failures.slice(0, SHOWN_FAILURES).map(describeFailure);
  if (count > SHOWN_FAILURES) shown.push(`… ${count - SHOWN_FAILURES} more in ci-report.json`);
  return [
    `### \`${step.id}\` failed: ${count} error${count === 1 ? '' : 's'}`,
    '',
    fenced('text', shown.join('\n\n')),
    '',
    'Run it locally:',
    '',
    fenced('bash', step.command.trim()),
    '',
  ];
}

function where(report: CiReport): string[] {
  const { id } = report.run;
  const json = `This report as JSON: \`gh run download ${id} -n ci-report-${report.job}\` (\`ci-report.json\`, described in CONTRIBUTING.md under "When CI fails").`;
  if (report.status !== 'failed') return [json, ''];
  const lines = [`The step's whole log: \`gh run view ${id} --log-failed\`. ${json}`];
  for (const artifact of report.artifacts) {
    lines.push(`What the failed run left: \`gh run download ${id} -n ${artifact}\`.`);
  }
  return [...lines, ''];
}

export function formatJobSummary(report: CiReport): string {
  const rows = report.steps.map(
    (step) =>
      `| \`${step.id}\` | ${RESULT[step.status]} | ${duration(step.durationSeconds)} | ${codeCell(step.command)} |`,
  );
  const failed = report.steps.find((step) => step.id === report.failedStep);
  const unfollowed =
    report.status === 'failed' && !failed
      ? [
          `A step without an id failed, and this report does not follow it: \`gh run view ${report.run.id} --log-failed\`.`,
          '',
        ]
      : [];
  return [
    heading(report),
    '',
    '| Step | Result | Time | Command |',
    '| --- | --- | --- | --- |',
    ...rows,
    '',
    ...(failed ? failedStep(failed, report) : unfollowed),
    ...where(report),
  ].join('\n');
}
