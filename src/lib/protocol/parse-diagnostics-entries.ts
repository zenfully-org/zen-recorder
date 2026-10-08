import { z } from 'zod';
import type { DiagnosticsEntry } from '@/lib/types';

const schema = z.array(
  z.object({
    at: z.number(),
    level: z.enum(['info', 'warn', 'error']),
    source: z.string(),
    message: z.string(),
  }),
);

/** Validates persisted diagnostics; anything malformed yields an empty log rather than a crash. */
export function parseDiagnosticsEntries(input: unknown): DiagnosticsEntry[] {
  const result = schema.safeParse(input);
  return result.success ? result.data : [];
}
