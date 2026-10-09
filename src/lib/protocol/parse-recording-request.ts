import { z } from 'zod';

const schema = z.object({ id: z.string().min(1) });

/**
 * Validates a request about one recording from the popup (Show file, Retry save, Remove); null
 * when malformed.
 */
export function parseRecordingRequest(input: unknown): { id: string } | null {
  const result = schema.safeParse(input);
  return result.success ? result.data : null;
}
