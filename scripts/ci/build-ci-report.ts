/**
 * Assembles a job's report: GitHub's steps context gives every step with an id and how it ended,
 * in run order; `run-step.ts`'s records add what a `run` step ran, its exit status and its time;
 * a failed step's log gives its errors. Steps the workflow gave no id are recorded but not in
 * the context, so they come last.
 */
import type { StepOutcome } from './parse-steps-context';
import type { CiReport, ReportStep, RunInfo, StepFailure, StepRecord, StepStatus } from './types';

export interface BuildCiReportInput {
  job: string;
  jobName: string;
  /** `job.status` as GitHub gives it: success, failure or cancelled. */
  jobStatus: string;
  run: RunInfo;
  context: { id: string; outcome: StepOutcome }[];
  records: StepRecord[];
  /** The errors in a failed step's log. */
  failuresOf: (step: string) => StepFailure[];
  artifacts: string[];
}

const STATUS: Record<StepOutcome, StepStatus> = {
  success: 'passed',
  failure: 'failed',
  cancelled: 'cancelled',
  skipped: 'skipped',
};

function jobStatusOf(status: string): CiReport['status'] {
  if (status === 'success') return 'passed';
  return status === 'cancelled' ? 'cancelled' : 'failed';
}

function reportStep(
  id: string,
  status: StepStatus,
  record: StepRecord | undefined,
  failuresOf: (step: string) => StepFailure[],
): ReportStep {
  const followed = record !== undefined && status === 'failed';
  return {
    id,
    command: record?.command ?? null,
    status,
    durationSeconds: record ? Math.round((record.endedAt - record.startedAt) / 100) / 10 : null,
    exitCode: record?.exitCode ?? null,
    log: followed ? `logs/${id}.log` : null,
    failures: followed ? failuresOf(id) : [],
  };
}

export function buildCiReport(input: BuildCiReportInput): CiReport {
  const records = new Map(input.records.map((record) => [record.step, record]));
  const known = new Set(input.context.map((step) => step.id));
  const steps = [
    ...input.context.map(({ id, outcome }) =>
      reportStep(id, STATUS[outcome], records.get(id), input.failuresOf),
    ),
    ...input.records
      .filter((record) => !known.has(record.step))
      .map((record) =>
        reportStep(
          record.step,
          record.exitCode === 0 ? 'passed' : 'failed',
          record,
          input.failuresOf,
        ),
      ),
  ];
  return {
    version: 1,
    job: input.job,
    jobName: input.jobName,
    status: jobStatusOf(input.jobStatus),
    run: input.run,
    failedStep: steps.find((step) => step.status === 'failed')?.id ?? null,
    steps,
    artifacts: input.artifacts,
  };
}
