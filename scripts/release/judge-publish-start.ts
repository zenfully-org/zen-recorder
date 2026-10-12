import { readAmoVersion } from './read-amo-version';
import type { AmoChannel } from './read-release-xpi';

/** A run of the release workflow, as GitHub's API lists it. */
export interface ReleaseRun {
  /** The branch or tag it runs on. */
  headBranch: string;
  /** `completed` once it ended; `queued`, `in_progress`, `waiting` (for an approval) and the like before. */
  status: string;
  url: string;
}

export type PublishStartVerdict =
  | { verdict: 'start' }
  | { verdict: 'wait'; reason: string }
  | { verdict: 'fail'; reason: string };

/**
 * Whether to start the release workflow's publish mode on the pre-release of `version`: once
 * addons.mozilla.org made the version public on the release's channel (`amo`, its answer to an
 * anonymous `GET addon/<id>/versions/<version>/`), and while no run of the release workflow on
 * the tag is still going, since a publish run waits for the maintainer's approval. AMO describes a
 * listed version to anyone only once it is public and answers 401 before that; an unlisted one
 * never, so an unlisted release is left to the maintainer. An answer AMO should not give fails.
 */
export function judgePublishStart(input: {
  version: string;
  channel: AmoChannel;
  amo: { status: number; answer: unknown };
  runs: readonly ReleaseRun[];
}): PublishStartVerdict {
  const tag = `v${input.version}`;
  const going = input.runs.find((run) => run.headBranch === tag && run.status !== 'completed');
  if (going !== undefined) {
    return {
      verdict: 'wait',
      reason: `a release run on ${tag} has not finished (${going.status}): ${going.url}`,
    };
  }
  if (input.channel === 'unlisted') {
    return {
      verdict: 'wait',
      reason: `addons.mozilla.org shows unlisted versions to their developers only: once it signed ${input.version}, run the release workflow on ${tag} in the publish mode`,
    };
  }
  const { status, answer } = input.amo;
  if (status === 200) {
    const reading = readAmoVersion(answer, { version: input.version, channel: input.channel });
    return reading.ready ? { verdict: 'start' } : { verdict: 'wait', reason: reading.reason };
  }
  if (status === 401 || status === 403) {
    return {
      verdict: 'wait',
      reason: `addons.mozilla.org has not made ${input.version} public yet: it answers ${status} without the API key until a reviewer approves it`,
    };
  }
  if (status === 404) {
    return {
      verdict: 'wait',
      reason: `addons.mozilla.org has no version ${input.version}: the release has not submitted it yet`,
    };
  }
  return {
    verdict: 'fail',
    reason: `addons.mozilla.org answered ${status} for ${input.version}: ${JSON.stringify(answer)}`,
  };
}
