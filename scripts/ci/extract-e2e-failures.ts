/**
 * The failures the end-to-end run printed, one line per service that failed
 * (`scripts/e2e/describe-e2e-failure.ts`): `✘ <service>: scenario <name> (<function>) failed:
 * <check>`, or `✘ <service>: failed before the scenarios: <error>`.
 */
import { makeFailure } from './make-failure';
import type { StepFailure } from './types';

const FAILED = /^✘ (\S+): (?:scenario (\S+) \((\S+)\) failed|failed before the scenarios): (.*)$/;

export function extractE2eFailures(log: string): StepFailure[] {
  return log.split('\n').flatMap((line) => {
    const match = FAILED.exec(line);
    if (!match) return [];
    return [
      makeFailure({
        tool: 'e2e',
        message: match[4] ?? '',
        test: match[3] ?? null,
        scenario: match[2] ?? null,
        provider: match[1] ?? null,
      }),
    ];
  });
}
