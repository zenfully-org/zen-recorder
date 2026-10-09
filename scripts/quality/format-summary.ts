/**
 * The console summary of a run: one line when everything passes, else one line per failure with
 * the place, the function, the metric, the numbers and what to do, then the new clones, then the
 * broken import rules with the chain of files. Either way, the slack follows: what the baselines
 * could be lowered to, which does not fail the run.
 */
import { describeFailure } from './describe-failure';
import type { Clone, Failure, ImportViolation, Summary } from './types';

const UPDATE = 'pnpm check:quality --update-baseline';

function describe(failure: Failure): string {
  return `  ${describeFailure(failure, { asSlack: false })}`;
}

function counted(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** What could be lowered, under a heading that names the command; nothing when the baselines are tight. */
function slackLines(summary: Summary): string[] {
  const { slack, goneClones } = summary;
  if (slack.length === 0 && goneClones === 0) return [];
  const counts = [
    ...(slack.length > 0 ? [counted(slack.length, 'baseline entry', 'baseline entries')] : []),
    ...(goneClones > 0 ? [counted(goneClones, 'known clone', 'known clones')] : []),
  ];
  return [
    `Could be lowered with ${UPDATE}: ${counts.join(', ')}`,
    ...slack.map((failure) => `  ${describeFailure(failure, { asSlack: true })}`),
    ...(goneClones > 0
      ? [`  ${counted(goneClones, 'known clone is', 'known clones are')} gone from the code`]
      : []),
  ];
}

function describeClone(clone: Clone): string {
  return `  ${clone.lines} lines  ${clone.first.file}:${clone.first.line}  ${clone.second.file}:${clone.second.line}`;
}

function describeImport(violation: ImportViolation): string {
  return `  ${violation.rule}  ${[violation.from, ...violation.to].join(' → ')}`;
}

/** The new clones and the known ones gone from the code, when they fail the run. */
function cloneLines({ newClones, staleClones }: Summary): string[] {
  if (newClones.length === 0 && staleClones === 0) return [];
  const gone =
    staleClones > 0
      ? [
          `  ${counted(staleClones, 'known clone is', 'known clones are')} gone: prune .jscpd-baseline.json with ${UPDATE}`,
        ]
      : [];
  return [
    `Duplicated blocks: ${newClones.length} new`,
    ...newClones.map(describeClone),
    ...gone,
    '',
  ];
}

function importLines({ importViolations }: Summary): string[] {
  if (importViolations.length === 0) return [];
  return [
    `Import rules (.dependency-cruiser.cjs): ${importViolations.length} broken`,
    ...importViolations.map(describeImport),
    '',
  ];
}

export function formatSummary(summary: Summary): string {
  const { failures, newClones, staleClones, knownOffenders, knownClones, importViolations } =
    summary;
  const count =
    failures.length + newClones.length + (staleClones > 0 ? 1 : 0) + importViolations.length;
  const slack = slackLines(summary);
  if (count === 0) {
    const ok = `Quality gates: ok (${knownOffenders} known offenders in quality-baseline.json, ${knownClones} known clones in .jscpd-baseline.json, no circular imports)`;
    return [ok, ...(slack.length > 0 ? ['', ...slack] : [])].join('\n');
  }
  return [
    `Quality gates: ${counted(count, 'failure', 'failures')}`,
    '',
    ...(failures.length > 0 ? [...failures.map(describe), ''] : []),
    ...cloneLines(summary),
    ...importLines(summary),
    ...(slack.length > 0 ? [...slack, ''] : []),
    'Rules: eslint.config.js (metrics and code smells), .jscpd.json (clones), knip.jsonc (unused code). Known offenders: quality-baseline.json and .jscpd-baseline.json, which no value may exceed.',
  ].join('\n');
}
