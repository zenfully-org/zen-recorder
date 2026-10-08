import { z } from 'zod';
import type { PageLog } from '@/lib/types';

const schema = z.object({
  level: z.enum(['info', 'warn', 'error']),
  message: z.string().max(2000),
});

/** Validates a log line forwarded from the page; null when malformed. */
export function parsePageLog(input: unknown): PageLog | null {
  const result = schema.safeParse(input);
  return result.success ? result.data : null;
}
