/**
 * Says whether the release workflow's publish mode should start on the newest release: when it is
 * an unsigned pre-release (`findUnsignedPreRelease`), addons.mozilla.org made its version public,
 * and no run of the release workflow on its tag is still going (`judgePublishStart`). It asks
 * AMO's public API, without a key. The hourly "Finish a signed release" workflow runs it and
 * starts the publish mode on the tag it names.
 *
 * Usage: tsx scripts/release/check-amo-approval.ts --channel <listed|unlisted> [--output <file>]
 * Env: GH_REPO (owner/name) and GH_TOKEN, for `gh`. With `--output` (the step's $GITHUB_OUTPUT),
 * a release to publish is appended to it as `tag=v<version>`.
 *
 * Exit status: 0 decided (the tag to publish, or a notice saying why not), 1 AMO gave an answer it
 * should not, 2 usage or a request that failed.
 */
import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { z } from 'zod';
import { getAddOnId } from '../../src/lib/get-add-on-id';
import { escapeCommandData } from '../ci/escape-command-data';
import { findUnsignedPreRelease } from './find-unsigned-pre-release';
import { judgePublishStart } from './judge-publish-start';
import { parseReleaseList } from './parse-release-list';

const USAGE = 'usage: check-amo-approval.ts --channel <listed|unlisted> [--output <file>]';
const API = 'https://addons.mozilla.org/api/v5/addons/addon';

const AmoChannel = z.enum(['listed', 'unlisted']);
const WorkflowRuns = z.object({
  workflow_runs: z.array(
    z.object({ head_branch: z.string().nullable(), status: z.string(), html_url: z.string() }),
  ),
});

function fail(message: string, status: 1 | 2): never {
  const line = `check-amo-approval: ${message}`;
  console.log(`::error::${escapeCommandData(line)}`);
  process.exit(status);
}

function parseOptions() {
  try {
    const { values } = parseArgs({
      options: { channel: { type: 'string' }, output: { type: 'string' } },
    });
    if (values.channel === undefined) return fail(USAGE, 2);
    const channel = AmoChannel.safeParse(values.channel).data;
    if (channel === undefined) {
      return fail(
        `the channel is "${values.channel}": the repository variable AMO_CHANNEL must be listed or unlisted`,
        2,
      );
    }
    return { channel, output: values.output };
  } catch {
    return fail(USAGE, 2);
  }
}

/** The JSON `gh api` prints for an endpoint. */
function ghApi(endpoint: string): unknown {
  try {
    const out = execFileSync('gh', ['api', endpoint], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'inherit'],
    });
    return JSON.parse(out);
  } catch {
    return fail(`gh api ${endpoint} failed (see above)`, 2);
  }
}

/** AMO's answer to an anonymous request: its status and its JSON (or its text when not JSON). */
async function askAmo(url: string): Promise<{ status: number; answer: unknown }> {
  try {
    const response = await fetch(url, { headers: { Accept: 'application/json' } });
    const text = await response.text();
    try {
      return { status: response.status, answer: JSON.parse(text) };
    } catch {
      return { status: response.status, answer: text };
    }
  } catch (error) {
    return fail(`GET ${url} failed: ${error instanceof Error ? error.message : String(error)}`, 2);
  }
}

const options = parseOptions();
// One page holds every release for years: the project releases every few weeks.
const releases = (() => {
  try {
    return parseReleaseList(ghApi('repos/{owner}/{repo}/releases?per_page=100'));
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error), 2);
  }
})();
const candidate = findUnsignedPreRelease(releases);
if (!candidate.found) {
  console.log(`::notice::${escapeCommandData(candidate.reason)}`);
  process.exit(0);
}

const runs = WorkflowRuns.safeParse(
  ghApi(
    `repos/{owner}/{repo}/actions/workflows/release.yml/runs?branch=${encodeURIComponent(candidate.tag)}&per_page=100`,
  ),
);
if (!runs.success) fail("GitHub's answer is not a list of workflow runs", 2);
const amoUrl = `${API}/${encodeURIComponent(getAddOnId())}/versions/${encodeURIComponent(candidate.version)}/`;
const amo = await askAmo(amoUrl);
console.log(`check-amo-approval: GET ${amoUrl} answered ${amo.status}`);

const judged = judgePublishStart({
  version: candidate.version,
  channel: options.channel,
  amo,
  runs: runs.data.workflow_runs.map((run) => ({
    headBranch: run.head_branch ?? '',
    status: run.status,
    url: run.html_url,
  })),
});
if (judged.verdict === 'fail') fail(judged.reason, 1);
if (judged.verdict === 'wait') {
  const line = `${candidate.tag}: ${judged.reason}`;
  console.log(`::notice::${escapeCommandData(line)}`);
} else {
  console.log(
    `check-amo-approval: addons.mozilla.org approved ${candidate.version}: publish ${candidate.tag}`,
  );
  if (options.output !== undefined) appendFileSync(options.output, `tag=${candidate.tag}\n`);
}
