import { z } from 'zod';

const schema = z.object({ name: z.string().min(1) });

/** Validates a request for a named diagnostics probe (test builds); null when malformed. */
export function parseProbeRequest(input: unknown): { name: string } | null {
  const result = schema.safeParse(input);
  return result.success ? result.data : null;
}
