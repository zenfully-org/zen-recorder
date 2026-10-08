/**
 * The errors a failed step's log holds, read by every extractor of a tool CI runs; when none of
 * them recognizes anything, the end of the log.
 */
import { stripVTControlCharacters } from 'node:util';
import { extractAnnotations } from './extract-annotations';
import { extractBiomeErrors } from './extract-biome-errors';
import { extractConventionErrors } from './extract-convention-errors';
import { extractCoverageFailures } from './extract-coverage-failures';
import { extractE2eFailures } from './extract-e2e-failures';
import { extractLogTail } from './extract-log-tail';
import { extractQualityFailures } from './extract-quality-failures';
import { extractTscErrors } from './extract-tsc-errors';
import type { StepFailure } from './types';

export interface FindFailuresDeps {
  /** The repository's root, which absolute paths in the log are made relative to. */
  root: string;
  /** `.coverage/coverage-final.json`, or null when the run wrote none. */
  readCoverage: () => string | null;
}

export function findFailures(log: string, deps: FindFailuresDeps): StepFailure[] {
  const text = stripVTControlCharacters(log);
  const failures = [
    ...extractAnnotations(text, deps.root),
    ...extractTscErrors(text),
    ...extractBiomeErrors(text),
    ...extractConventionErrors(text),
    ...extractQualityFailures(text),
    ...extractCoverageFailures(text, deps.readCoverage, deps.root),
    ...extractE2eFailures(text),
  ];
  return failures.length > 0 ? failures : extractLogTail(text);
}
