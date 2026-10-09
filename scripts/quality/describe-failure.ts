/**
 * One line for what the comparison with the baseline found: the place, the function, the metric,
 * the numbers and the verdict, separated by two spaces. As slack (`asSlack`), an improvement gives
 * only its numbers: the list it is in already says how to lower the baseline.
 */
import type { Failure } from './types';

const UPDATE = 'pnpm check:quality --update-baseline';

/** A measure that only says yes or no (an unused export, two identical functions) has no value to show. */
function isYesOrNo(failure: Failure): boolean {
  return failure.value === null || (failure.value === 1 && failure.threshold === null);
}

/** What a failure asks for. An inline eslint comment never goes into the baseline: it has to go. */
function verdictOf(failure: Failure, asSlack: boolean): string {
  if (failure.metric === 'no-inline-config' && failure.kind === 'new') {
    return 'an inline eslint comment has no effect: remove it';
  }
  const lower = asSlack ? '' : `: lower the baseline with ${UPDATE}`;
  const remove = asSlack ? '' : `: remove it with ${UPDATE}`;
  return {
    new: 'new offender',
    worse: `got worse (baseline ${failure.baseline})`,
    improved:
      failure.value === null
        ? `gone (baseline ${failure.baseline})${lower}`
        : `improved (baseline ${failure.baseline})${lower}`,
    stale: `stale entry (baseline ${failure.baseline})${remove}`,
  }[failure.kind];
}

/** The metric with its value and threshold, or the metric alone for a yes-or-no measure. */
function measuredOf(failure: Failure): string {
  if (isYesOrNo(failure)) return failure.metric;
  const over = failure.threshold === null ? '' : ` > ${failure.threshold}`;
  return `${failure.metric} ${failure.value}${over}`;
}

export function describeFailure(failure: Failure, options: { asSlack: boolean }): string {
  const measured = measuredOf(failure);
  const place =
    failure.line === null || failure.line === 0 ? failure.file : `${failure.file}:${failure.line}`;
  return `${place}  ${failure.key}  ${measured}  ${verdictOf(failure, options.asSlack)}`;
}
