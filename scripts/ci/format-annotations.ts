/**
 * Workflow commands that put the report's errors on their lines in the pull request's diff, for
 * the tools that do not write annotations themselves (tsc, Biome's default report, the
 * conventions, the quality gates, coverage). Vitest's errors, and any a step wrote itself, are
 * annotated already.
 */
import type { CiReport, StepFailure } from './types';

/** GitHub shows at most 10 error annotations per step. */
const MAX_ANNOTATIONS = 10;

const escapeData = (text: string) =>
  text.replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A');
const escapeProperty = (text: string) =>
  escapeData(text).replaceAll(':', '%3A').replaceAll(',', '%2C');

function annotate(failure: StepFailure & { file: string }): string {
  const properties = [
    `file=${escapeProperty(failure.file)}`,
    ...(failure.line === null ? [] : [`line=${failure.line}`]),
    ...(failure.column === null ? [] : [`col=${failure.column}`]),
    `title=${escapeProperty([failure.tool, failure.rule].filter((part) => part !== null).join(' '))}`,
  ];
  return `::error ${properties.join(',')}::${escapeData(failure.message)}`;
}

const isNew = (failure: StepFailure): failure is StepFailure & { file: string } =>
  failure.file !== null && failure.tool !== 'vitest' && failure.tool !== 'annotation';

export function formatAnnotations(report: CiReport): string[] {
  return report.steps
    .flatMap((step) => step.failures)
    .filter(isNew)
    .slice(0, MAX_ANNOTATIONS)
    .map(annotate);
}
