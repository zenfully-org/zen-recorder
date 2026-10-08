/**
 * The line the end-to-end run prints when a service's run fails: the service, the scenario (by
 * the name E2E_SCENARIOS takes, and its function) or "before the scenarios", and the first line of
 * the error, which names the check. CI's report reads it back (`scripts/ci/extract-e2e-failures.ts`).
 */

export interface FailedScenario {
  /** The name E2E_SCENARIOS takes, like `35` or `routing`. */
  name: string;
  /** The function that runs it, like `scenarioFirstSecondsHaveAudio`. */
  test: string;
}

function firstLine(error: unknown): string {
  const text = error instanceof Error ? error.message || error.name : String(error);
  return text.split('\n')[0]?.trim() ?? '';
}

export function describeE2eFailure(
  provider: string,
  scenario: FailedScenario | null,
  error: unknown,
): string {
  const what = scenario
    ? `scenario ${scenario.name} (${scenario.test}) failed`
    : 'failed before the scenarios';
  return `✘ ${provider}: ${what}: ${firstLine(error)}`;
}
