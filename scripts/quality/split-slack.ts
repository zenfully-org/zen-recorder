/**
 * Splits what the comparison with the baselines found into what fails the run and the slack: an
 * entry the code is now better than (an improved value, a finding gone, a stale entry) and a known
 * clone gone from the code. Slack passes and is listed, so two pull requests that improve the same
 * function never both have to edit its line of quality-baseline.json; the baselines are lowered on
 * their own, and `--strict` (the scheduled check) fails on slack until they are.
 */
import type { Failure } from './types';

export interface Compared {
  failures: Failure[];
  /** Fingerprints in .jscpd-baseline.json that no clone matched any more. */
  staleClones: number;
}

export interface Split extends Compared {
  slack: Failure[];
  goneClones: number;
}

export function splitSlack(compared: Compared, options: { strict: boolean }): Split {
  if (options.strict) return { ...compared, slack: [], goneClones: 0 };
  const isSlack = (failure: Failure) => failure.kind === 'improved' || failure.kind === 'stale';
  return {
    failures: compared.failures.filter((failure) => !isSlack(failure)),
    staleClones: 0,
    slack: compared.failures.filter(isSlack),
    goneClones: compared.staleClones,
  };
}
