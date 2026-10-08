/**
 * The console summary of a run: one line when everything passes, else one line per failure with
 * the place, the function, the metric, the numbers and what to do, then the new clones, then the
 * broken import rules with the chain of files.
 */
import type { Clone, Failure, ImportViolation, Summary } from './types';

const UPDATE = 'pnpm check:quality --update-baseline';

/** A measure that only says yes or no (an unused export, two identical functions) has no value to show. */
function isYesOrNo(failure: Failure): boolean {
  return failure.value === null || (failure.value === 1 && failure.threshold === null);
}

function describe(failure: Failure): string {
  const measured = isYesOrNo(failure)
    ? failure.metric
    : `${failure.metric} ${failure.value}${failure.threshold === null ? '' : ` > ${failure.threshold}`}`;
  const place =
    failure.line === null || failure.line === 0 ? failure.file : `${failure.file}:${failure.line}`;
  return `  ${place}  ${failure.key}  ${measured}  ${verdictOf(failure)}`;
}

/** What a failure asks for. An inline eslint comment never goes into the baseline: it has to go. */
function verdictOf(failure: Failure): string {
  if (failure.metric === 'no-inline-config' && failure.kind === 'new') {
    return 'an inline eslint comment has no effect: remove it';
  }
  return {
    new: 'new offender',
    worse: `got worse (baseline ${failure.baseline})`,
    improved:
      failure.value === null
        ? `gone (baseline ${failure.baseline}): lower the baseline with ${UPDATE}`
        : `improved (baseline ${failure.baseline}): lower the baseline with ${UPDATE}`,
    stale: `stale entry (baseline ${failure.baseline}): remove it with ${UPDATE}`,
  }[failure.kind];
}

function describeClone(clone: Clone): string {
  return `  ${clone.lines} lines  ${clone.first.file}:${clone.first.line}  ${clone.second.file}:${clone.second.line}`;
}

function describeImport(violation: ImportViolation): string {
  return `  ${violation.rule}  ${[violation.from, ...violation.to].join(' → ')}`;
}

export function formatSummary(summary: Summary): string {
  const { failures, newClones, staleClones, knownOffenders, knownClones, importViolations } =
    summary;
  const count =
    failures.length + newClones.length + (staleClones > 0 ? 1 : 0) + importViolations.length;
  if (count === 0) {
    return `Quality gates: ok (${knownOffenders} known offenders in quality-baseline.json, ${knownClones} known clones in .jscpd-baseline.json, no circular imports)`;
  }
  const lines = [`Quality gates: ${count} failure${count === 1 ? '' : 's'}`, ''];
  if (failures.length > 0) lines.push(...failures.map(describe), '');
  if (newClones.length > 0 || staleClones > 0) {
    lines.push(`Duplicated blocks: ${newClones.length} new`, ...newClones.map(describeClone));
    if (staleClones > 0) {
      lines.push(
        `  ${staleClones} known clone${staleClones === 1 ? ' is' : 's are'} gone: prune .jscpd-baseline.json with ${UPDATE}`,
      );
    }
    lines.push('');
  }
  if (importViolations.length > 0) {
    lines.push(
      `Import rules (.dependency-cruiser.cjs): ${importViolations.length} broken`,
      ...importViolations.map(describeImport),
      '',
    );
  }
  lines.push(
    'Rules: eslint.config.js (metrics and code smells), .jscpd.json (clones), knip.jsonc (unused code). Known offenders: quality-baseline.json and .jscpd-baseline.json, which may only shrink.',
  );
  return lines.join('\n');
}
