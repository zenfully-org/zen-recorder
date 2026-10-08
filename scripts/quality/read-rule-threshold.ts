/**
 * Reads the threshold an ESLint rule entry sets, as `calculateConfigForFile` gives it: the severity
 * and then the rule's options, either the number itself (`[2, 15]`) or an object holding it under
 * the name the rule uses (`threshold`, `maximum` or `max`). Null for a rule that is off, not
 * configured, or configured without a threshold.
 */
import { z } from 'zod';

const NUMBER = z.number();
const OPTIONS = z.object({
  threshold: NUMBER.optional(),
  maximum: NUMBER.optional(),
  max: NUMBER.optional(),
});
const ENTRY = z.tuple([z.union([z.number(), z.string()]), z.unknown()]).rest(z.unknown());

export function readRuleThreshold(entry: unknown): number | null {
  const parsed = ENTRY.safeParse(entry);
  if (!parsed.success) return null;
  const [severity, option] = parsed.data;
  if (severity === 0 || severity === 'off') return null;
  const number = NUMBER.safeParse(option);
  if (number.success) return number.data;
  const options = OPTIONS.safeParse(option);
  if (!options.success) return null;
  return options.data.threshold ?? options.data.maximum ?? options.data.max ?? null;
}
