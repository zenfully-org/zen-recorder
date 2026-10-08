/**
 * Reads a CI job's report (`ci-report.json`, version 1), and checks one before it is written, so
 * the file always has the documented shape (CONTRIBUTING.md, "When CI fails"). Tools that read
 * the report can parse it the same way.
 */
import { z } from 'zod';
import type { CiReport } from './types';

const FAILURE = z.object({
  tool: z.enum([
    'annotation',
    'vitest',
    'coverage',
    'tsc',
    'biome',
    'conventions',
    'quality',
    'e2e',
    'log',
  ]),
  message: z.string(),
  file: z.string().nullable(),
  line: z.number().int().nullable(),
  column: z.number().int().nullable(),
  rule: z.string().nullable(),
  test: z.string().nullable(),
  scenario: z.string().nullable(),
  provider: z.string().nullable(),
});

const REPORT: z.ZodType<CiReport> = z.object({
  version: z.literal(1),
  job: z.string(),
  jobName: z.string(),
  status: z.enum(['passed', 'failed', 'cancelled']),
  run: z.object({
    workflow: z.string(),
    id: z.number().int(),
    attempt: z.number().int(),
    url: z.string(),
    sha: z.string(),
    ref: z.string(),
    event: z.string(),
  }),
  failedStep: z.string().nullable(),
  steps: z.array(
    z.object({
      id: z.string(),
      command: z.string().nullable(),
      status: z.enum(['passed', 'failed', 'skipped', 'cancelled']),
      durationSeconds: z.number().nullable(),
      exitCode: z.number().int().nullable(),
      log: z.string().nullable(),
      failures: z.array(FAILURE),
    }),
  ),
  artifacts: z.array(z.string()),
});

export function parseCiReport(value: unknown): CiReport {
  const parsed = REPORT.safeParse(value);
  if (!parsed.success) {
    const problems = parsed.error.issues
      .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('; ');
    throw new Error(`not a CI report of version 1: ${problems}`);
  }
  return parsed.data;
}
