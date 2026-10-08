/**
 * Reads `quality-baseline.json`: file → function → metric → the known value, or a list of values
 * when one function has several findings of a metric.
 */
import { z } from 'zod';
import type { Baseline } from './types';

const VALUE = z.union([z.number().int().nonnegative(), z.array(z.number().int().nonnegative())]);
const BASELINE = z.record(z.string(), z.record(z.string(), z.record(z.string(), VALUE)));

export function parseBaseline(text: string): Baseline {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (error) {
    throw new Error(`quality-baseline.json is not JSON: ${String(error)}`);
  }
  const parsed = BASELINE.safeParse(data);
  if (!parsed.success) {
    throw new Error(`quality-baseline.json has an unexpected shape: ${parsed.error.message}`);
  }
  return parsed.data;
}
