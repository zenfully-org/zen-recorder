/** Reads what `run-step.ts` recorded for each `run` step of the job, in the order they started. */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import type { StepRecord } from './types';

const RECORD = z.object({
  step: z.string(),
  command: z.string(),
  exitCode: z.number().int(),
  startedAt: z.number(),
  endedAt: z.number(),
});

export function readStepRecords(dir: string): StepRecord[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .map((name) => {
      const parsed = RECORD.safeParse(JSON.parse(readFileSync(path.join(dir, name), 'utf8')));
      if (!parsed.success) {
        throw new Error(`the step record ${name} has an unexpected shape: ${parsed.error.message}`);
      }
      return parsed.data;
    })
    .sort((a, b) => a.startedAt - b.startedAt);
}
