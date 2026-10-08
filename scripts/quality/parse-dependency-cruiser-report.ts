/**
 * Reads the JSON report dependency-cruiser writes (`--output-type json`): every import that breaks
 * a rule of .dependency-cruiser.cjs. A circular import comes as the dependency that closes it plus
 * the files it runs through, ending where it started; dependency-cruiser reports each cycle once.
 * Paths come relative to the repository root with forward slashes, on every platform.
 */
import { z } from 'zod';
import type { ImportViolation } from './types';

const REPORT = z.object({
  summary: z.object({
    violations: z.array(
      z.object({
        from: z.string(),
        to: z.string(),
        rule: z.object({ name: z.string() }),
        cycle: z.array(z.object({ name: z.string() })).optional(),
      }),
    ),
  }),
});

export function parseDependencyCruiserReport(text: string): ImportViolation[] {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (error) {
    throw new Error(`the dependency-cruiser report is not JSON: ${String(error)}`);
  }
  const parsed = REPORT.safeParse(data);
  if (!parsed.success) {
    throw new Error(
      `the dependency-cruiser report has an unexpected shape: ${parsed.error.message}`,
    );
  }
  return parsed.data.summary.violations.map((violation) => ({
    rule: violation.rule.name,
    from: violation.from,
    to: violation.cycle?.map((step) => step.name) ?? [violation.to],
  }));
}
