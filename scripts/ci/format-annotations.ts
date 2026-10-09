/**
 * Workflow commands that put the report's errors on the run's page, and on their lines in the pull
 * request's diff when they name a file, for the tools that do not write annotations themselves
 * (Biome's default report, the conventions, the quality gates, coverage, the end-to-end run).
 * Vitest's errors, tsc's and any a step wrote itself are annotated already; the end of a log is
 * too long for one and stays in the summary.
 */
import { escapeCommandData } from './escape-command-data';
import type { CiReport, StepFailure } from './types';

/** GitHub shows at most 10 error annotations per step. */
const MAX_ANNOTATIONS = 10;

const escapeProperty = (text: string) =>
  escapeCommandData(text).replaceAll(':', '%3A').replaceAll(',', '%2C');

function title(failure: StepFailure): string {
  const scenario = failure.scenario === null ? null : `scenario ${failure.scenario}`;
  return [failure.tool, failure.rule, failure.provider, scenario]
    .filter((part) => part !== null)
    .join(' ');
}

function annotate(failure: StepFailure): string {
  const properties = [
    ...(failure.file === null ? [] : [`file=${escapeProperty(failure.file)}`]),
    ...(failure.line === null ? [] : [`line=${failure.line}`]),
    ...(failure.column === null ? [] : [`col=${failure.column}`]),
    `title=${escapeProperty(title(failure))}`,
  ];
  return `::error ${properties.join(',')}::${escapeCommandData(failure.message)}`;
}

/** Vitest annotates its failures, actions/setup-node registers a problem matcher for tsc's. */
const ANNOTATED_ELSEWHERE = new Set<StepFailure['tool']>(['vitest', 'tsc', 'annotation', 'log']);

export function formatAnnotations(report: CiReport): string[] {
  return report.steps
    .flatMap((step) => step.failures)
    .filter((failure) => !ANNOTATED_ELSEWHERE.has(failure.tool))
    .slice(0, MAX_ANNOTATIONS)
    .map(annotate);
}
