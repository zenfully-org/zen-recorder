import { z } from 'zod';

const tableSchema = z.object({
  seconds: z.record(z.string(), z.record(z.string(), z.number().nonnegative())),
});

/**
 * How long each scenario takes on `provider`, from the table `pnpm e2e:seconds` writes
 * (`scenario-seconds.json`), as `E2E_SHARD` splits the run by it. A scenario the table does not
 * know yet (one added since) counts as the service's median scenario; on a service the table does
 * not know at all every scenario counts the same, so the shards take every n-th one.
 */
export function readScenarioSeconds(json: unknown, provider: string): (name: string) => number {
  const table = tableSchema.safeParse(json);
  if (!table.success) throw new Error(`scenario seconds: ${z.prettifyError(table.error)}`);
  const known = table.data.seconds[provider] ?? {};
  const sorted = Object.values(known).sort((a, b) => a - b);
  const typical = sorted[Math.floor(sorted.length / 2)] ?? 0;
  return (name) => known[name] ?? typical;
}
