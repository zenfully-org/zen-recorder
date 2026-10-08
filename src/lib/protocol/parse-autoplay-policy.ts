import { z } from 'zod';

/** What `navigator.getAutoplayPolicy()` answers (Autoplay Policy Detection). */
export type AutoplayPolicy = 'allowed' | 'allowed-muted' | 'disallowed';

const schema = z.enum(['allowed', 'allowed-muted', 'disallowed']);

/** Validates the browser's autoplay policy; null when it is something else. */
export function parseAutoplayPolicy(input: unknown): AutoplayPolicy | null {
  const result = schema.safeParse(input);
  return result.success ? result.data : null;
}
