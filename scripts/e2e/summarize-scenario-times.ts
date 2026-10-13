/** A passed scenario's line, `  ✓ <name> (<n> s)`, after the time GitHub writes before each line. */
const PASSED = /^(?:\S+Z )? {2}✓ ([a-z0-9-]+) \((\d+) s\)$/;

/** Seconds per scenario, per service: what `E2E_SHARD` splits a service's run by. */
export type ScenarioSeconds = Record<string, Record<string, number>>;

const median = (values: readonly number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? (sorted[middle] ?? 0)
    : Math.round(((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2);
};

/**
 * How long each scenario took on each service: the median of the `✓` lines of every end-to-end
 * log given (one per job), in whole seconds.
 */
export function summarizeScenarioTimes(
  logs: readonly { provider: string; text: string }[],
): ScenarioSeconds {
  const samples = new Map<string, Map<string, number[]>>();
  for (const { provider, text } of logs) {
    const byScenario = samples.get(provider) ?? new Map<string, number[]>();
    samples.set(provider, byScenario);
    for (const line of text.split('\n')) {
      const match = PASSED.exec(line.trimEnd());
      if (!match?.[1]) continue;
      byScenario.set(match[1], [...(byScenario.get(match[1]) ?? []), Number(match[2])]);
    }
  }
  return Object.fromEntries(
    [...samples.keys()]
      .sort()
      .map((provider) => [
        provider,
        Object.fromEntries(
          [...(samples.get(provider) ?? [])].map(([name, values]) => [name, median(values)]),
        ),
      ]),
  );
}
