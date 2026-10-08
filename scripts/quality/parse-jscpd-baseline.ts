/**
 * Reads `.jscpd-baseline.json`, the clone baseline jscpd writes: a content fingerprint per known
 * clone, with how many clones share it. The total says how many clones a run should still find;
 * fewer means some are gone and the file must be rewritten.
 */
import { z } from 'zod';

const BASELINE = z.object({
  version: z.number().int(),
  fingerprints: z.record(z.string(), z.number().int().nonnegative()),
});

export function parseJscpdBaseline(text: string): { total: number } {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (error) {
    throw new Error(`.jscpd-baseline.json is not JSON: ${String(error)}`);
  }
  const parsed = BASELINE.safeParse(data);
  if (!parsed.success) {
    throw new Error(`.jscpd-baseline.json has an unexpected shape: ${parsed.error.message}`);
  }
  return { total: Object.values(parsed.data.fingerprints).reduce((sum, count) => sum + count, 0) };
}
