/**
 * The report of one CI job: what each step ran, how it ended and how long it took, and for a
 * failed step the errors that matter. `write-report.ts` writes it as the job's summary on the run's
 * page and as `ci-report.json` in the job's artifact `ci-report-<job>`. The JSON is an interface
 * for other tools: its shape changes only with a new `version` (CONTRIBUTING.md, "When CI fails").
 */

/** How a step ended. */
export type StepStatus = 'passed' | 'failed' | 'skipped' | 'cancelled';

/** What `run-step.ts` records for each `run` step it runs. */
export interface StepRecord {
  /** The step's id in the workflow. */
  step: string;
  /** The script the step ran, as GitHub wrote it after expanding `${{ }}` expressions. */
  command: string;
  exitCode: number;
  /** Epoch milliseconds. */
  startedAt: number;
  endedAt: number;
}

/** The tool a failure comes from, which says how to read its other fields. */
type FailureTool =
  | 'annotation'
  | 'vitest'
  | 'coverage'
  | 'tsc'
  | 'biome'
  | 'conventions'
  | 'quality'
  | 'e2e'
  | 'log';

/** One error a failed step reported, as precise as its tool was; a field it did not say is null. */
export interface StepFailure {
  tool: FailureTool;
  message: string;
  /** Relative to the repository's root. */
  file: string | null;
  line: number | null;
  column: number | null;
  /** The lint rule, the TypeScript error code, the quality metric or the coverage measure. */
  rule: string | null;
  /** The failing test: a unit test's describe blocks and name, or an end-to-end scenario's function. */
  test: string | null;
  /** The end-to-end scenario, by the name E2E_SCENARIOS takes. */
  scenario: string | null;
  /** The meeting service the end-to-end run tested: meet, zoom or teams. */
  provider: string | null;
}

export interface ReportStep {
  /** The step's id in the workflow. */
  id: string;
  /** The script it ran; null for a step that runs an action (`uses:`). */
  command: string | null;
  status: StepStatus;
  durationSeconds: number | null;
  exitCode: number | null;
  /** A failed step's whole output, in the artifact next to ci-report.json. */
  log: string | null;
  failures: StepFailure[];
}

/** The run a report belongs to. */
export interface RunInfo {
  workflow: string;
  id: number;
  attempt: number;
  url: string;
  /** The commit the job checked out: for a pull request, its merge with the base branch. */
  sha: string;
  ref: string;
  event: string;
}

export interface CiReport {
  version: 1;
  /** The artifact's key: `gate`, `reproducible-build`, `e2e-meet`, ... */
  job: string;
  /** The check's name on the pull request, like `Gate` or `E2E (meet)`. */
  jobName: string;
  status: 'passed' | 'failed' | 'cancelled';
  run: RunInfo;
  /** The id of the first step that failed; null when none did. */
  failedStep: string | null;
  steps: ReportStep[];
  /** The job's other artifacts that help with a failure, like the files an end-to-end run left. */
  artifacts: string[];
}
