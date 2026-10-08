/** The run a report belongs to, from the variables GitHub Actions sets in every step. */
import { z } from 'zod';
import type { RunInfo } from './types';

const ENV = z.object({
  GITHUB_WORKFLOW: z.string(),
  GITHUB_RUN_ID: z.coerce.number().int(),
  GITHUB_RUN_ATTEMPT: z.coerce.number().int(),
  GITHUB_SERVER_URL: z.string(),
  GITHUB_REPOSITORY: z.string(),
  GITHUB_SHA: z.string(),
  GITHUB_REF: z.string(),
  GITHUB_EVENT_NAME: z.string(),
});

export function readRunInfo(env: Record<string, string | undefined>): RunInfo {
  const parsed = ENV.safeParse(env);
  if (!parsed.success) {
    const missing = parsed.error.issues.map((issue) => issue.path.join('.')).join(', ');
    throw new Error(`not a GitHub Actions run: ${missing} missing or wrong`);
  }
  const { data } = parsed;
  return {
    workflow: data.GITHUB_WORKFLOW,
    id: data.GITHUB_RUN_ID,
    attempt: data.GITHUB_RUN_ATTEMPT,
    url: `${data.GITHUB_SERVER_URL}/${data.GITHUB_REPOSITORY}/actions/runs/${data.GITHUB_RUN_ID}`,
    sha: data.GITHUB_SHA,
    ref: data.GITHUB_REF,
    event: data.GITHUB_EVENT_NAME,
  };
}
