import { z } from 'zod';
import type { ProviderId } from '@/lib/types';

/** The one zod definition of a provider id; other protocol schemas build on it. */
export const providerIdSchema = z.enum(['meet', 'zoom', 'teams']);

/** Validates a provider id; null when unknown. */
export function parseProviderId(input: unknown): ProviderId | null {
  const result = providerIdSchema.safeParse(input);
  return result.success ? result.data : null;
}
