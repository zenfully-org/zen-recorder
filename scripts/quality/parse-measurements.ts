/**
 * Reads what scripts/quality/measure-functions.ts prints: every function's (and file's) value of
 * each measured metric, and the thresholds that apply to each file.
 */
import { z } from 'zod';
import type { Measurements } from './types';

const MEASUREMENTS = z.object({
  measurements: z.array(
    z.object({
      file: z.string(),
      line: z.number().int(),
      key: z.string(),
      metric: z.string(),
      value: z.number(),
    }),
  ),
  thresholds: z.record(z.string(), z.record(z.string(), z.number())),
});

export function parseMeasurements(text: string): Measurements {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (error) {
    throw new Error(`the measurements are not JSON: ${String(error)}`);
  }
  const parsed = MEASUREMENTS.safeParse(data);
  if (!parsed.success) {
    throw new Error(`the measurements have an unexpected shape: ${parsed.error.message}`);
  }
  return parsed.data;
}
