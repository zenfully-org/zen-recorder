/** A check run of a commit, as GitHub's check-runs API lists it. */
export interface CheckRunState {
  name: string;
  status: string;
  conclusion: string | null;
}

export type ReleaseStartVerdict = { ok: true; tag: string } | { ok: false; problems: string[] };

/** Conclusions GitHub gives a check run that did not pass and will not pass without a new run. */
const FAILED = new Set([
  'failure',
  'cancelled',
  'timed_out',
  'action_required',
  'startup_failure',
  'stale',
]);

/**
 * Whether a release of `version` may start from a commit: its tag must be new, and every check
 * main requires must have passed on the commit. A commit on main is tested more than once (by the
 * merge queue before it lands, by the push to main after), so one passing run of a check is
 * enough while another is still going, but a failed one stops the release.
 */
export function judgeReleaseStart(input: {
  version: string;
  tagExists: boolean;
  requiredChecks: readonly string[];
  checkRuns: readonly CheckRunState[];
}): ReleaseStartVerdict {
  const tag = `v${input.version}`;
  const problems: string[] = [];
  if (input.tagExists) {
    problems.push(
      `${tag} exists already: a release pull request raises the version in package.json first.`,
    );
  }
  if (input.requiredChecks.length === 0) {
    problems.push(
      "main names no required check, so this commit's CI cannot be judged: check the branch's ruleset.",
    );
  }
  for (const name of input.requiredChecks) {
    const runs = input.checkRuns.filter((run) => run.name === name);
    if (runs.some((run) => run.status === 'completed' && FAILED.has(run.conclusion ?? ''))) {
      problems.push(`"${name}" failed on this commit: run it again, and start once it passes.`);
    } else if (!runs.some((run) => run.status === 'completed' && run.conclusion === 'success')) {
      problems.push(`"${name}" has not passed on this commit yet: wait for CI, then start again.`);
    }
  }
  return problems.length === 0 ? { ok: true, tag } : { ok: false, problems };
}
