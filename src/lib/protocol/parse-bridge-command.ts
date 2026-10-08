import { z } from 'zod';
import type { LifecycleCommand } from '@/lib/types';

const schema = z.object({ command: z.enum(['start', 'pause', 'resume', 'stop']) });

/** Validates a `bridge:command` message arriving in the page; null when malformed. */
export function parseBridgeCommand(input: unknown): LifecycleCommand | null {
  const result = schema.safeParse(input);
  return result.success ? result.data.command : null;
}
