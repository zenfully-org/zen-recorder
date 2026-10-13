/**
 * One shard of the run order (`E2E_SHARD=<k>/<n>`), so the n shards run side by side and end close
 * together: the scenarios go, the longest first (by `secondsOf`, the time each took on CI), each to
 * the shard with the least time so far, the first of those on a tie. Equal times go in run order,
 * so with no times known the shards take every n-th scenario. A shard keeps the run order: a
 * scenario that must come after another in its browser still does. Without a shard, the whole list.
 */
export function shardScenarios<T>(
  scenarios: readonly T[],
  shard: string | undefined,
  secondsOf: (scenario: T) => number,
): T[] {
  if (!shard) return [...scenarios];
  const match = /^(\d+)\/(\d+)$/.exec(shard);
  const index = Number(match?.[1]);
  const count = Number(match?.[2]);
  if (!match || index < 1 || index > count) {
    throw new Error(`E2E_SHARD must be <k>/<n> with 1 ≤ k ≤ n, like 2/3; got "${shard}"`);
  }
  const longestFirst = scenarios
    .map((scenario, position) => ({ position, seconds: secondsOf(scenario) }))
    .sort((a, b) => b.seconds - a.seconds || a.position - b.position);
  const loads = Array.from({ length: count }, () => 0);
  const shardOf = new Map<number, number>();
  for (const { position, seconds } of longestFirst) {
    const least = loads.indexOf(Math.min(...loads));
    loads[least] = (loads[least] ?? 0) + seconds;
    shardOf.set(position, least);
  }
  return scenarios.filter((_, position) => shardOf.get(position) === index - 1);
}
