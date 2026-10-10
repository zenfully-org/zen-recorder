/**
 * One shard of the run order (`E2E_SHARD=<k>/<n>`): every n-th scenario from the k-th, so the
 * shards together run each scenario once and the long ones spread over them. Without a shard,
 * the whole list.
 */
export function shardScenarios<T>(scenarios: readonly T[], shard: string | undefined): T[] {
  if (!shard) return [...scenarios];
  const match = /^(\d+)\/(\d+)$/.exec(shard);
  const index = Number(match?.[1]);
  const count = Number(match?.[2]);
  if (!match || index < 1 || index > count) {
    throw new Error(`E2E_SHARD must be <k>/<n> with 1 ≤ k ≤ n, like 2/3; got "${shard}"`);
  }
  return scenarios.filter((_, position) => position % count === index - 1);
}
