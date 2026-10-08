/**
 * Reads GitHub's steps context, which the report step gets as `toJSON(steps)`: every step with an
 * id that ran or was skipped so far, in that order, with its outcome. The outcome is how the step
 * itself ended; the conclusion differs only for a step allowed to fail (`continue-on-error`).
 */
import { z } from 'zod';

export type StepOutcome = 'success' | 'failure' | 'cancelled' | 'skipped';

const CONTEXT = z.record(
  z.string(),
  z.object({ outcome: z.enum(['success', 'failure', 'cancelled', 'skipped']) }),
);

export function parseStepsContext(
  json: string | undefined,
): { id: string; outcome: StepOutcome }[] {
  if (json === undefined || json.trim() === '') return [];
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch (error) {
    throw new Error(`the steps context is not JSON: ${String(error)}`);
  }
  const parsed = CONTEXT.safeParse(data);
  if (!parsed.success) {
    throw new Error(`the steps context has an unexpected shape: ${parsed.error.message}`);
  }
  return Object.entries(parsed.data).map(([id, { outcome }]) => ({ id, outcome }));
}
