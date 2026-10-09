import { z } from 'zod';
import type { LifecycleCommand } from '@/lib/types';

export const lifecycleCommandSchema = z.enum(['start', 'pause', 'resume', 'stop']);

/** Validates a recorder command (from the popup, overlay or keyboard shortcut); null when unknown. */
export function parseLifecycleCommand(input: unknown): LifecycleCommand | null {
  const result = lifecycleCommandSchema.safeParse(input);
  return result.success ? result.data : null;
}
