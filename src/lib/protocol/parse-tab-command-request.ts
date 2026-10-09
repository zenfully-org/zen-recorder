import { z } from 'zod';
import { lifecycleCommandSchema } from '@/lib/protocol/parse-lifecycle-command';
import type { LifecycleCommand } from '@/lib/types';

const schema = z.object({ tabId: z.number().int().nonnegative(), command: lifecycleCommandSchema });

/**
 * Validates a meeting tab's command from the popup (Record now, Pause, Resume, Stop & save); null
 * when malformed.
 */
export function parseTabCommandRequest(
  input: unknown,
): { tabId: number; command: LifecycleCommand } | null {
  const result = schema.safeParse(input);
  return result.success ? result.data : null;
}
