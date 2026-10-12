// @vitest-environment node
/**
 * An hourly check starts the release workflow's publish mode on an unsigned pre-release once
 * addons.mozilla.org approved its version. It asks AMO's public API, without a key: AMO describes
 * a listed version to anyone only once it is public (approved and signed), and answers 401 before
 * that. It never starts a second run while one on the tag is still going: a publish run waits for
 * the maintainer's approval, and two would ask twice.
 */
import { judgePublishStart } from './judge-publish-start';

const FILE = 'https://addons.mozilla.org/firefox/downloads/file/5100000/zen_recorder-0.5.0.xpi';
const approved = {
  status: 200,
  answer: {
    id: 6600000,
    version: '0.5.0',
    channel: 'listed',
    file: { id: 5100000, status: 'public', url: FILE },
  },
};
const UNAUTHORIZED = {
  status: 401,
  answer: {
    detail: 'Authentication credentials were not provided.',
    is_disabled_by_developer: false,
    is_disabled_by_mozilla: false,
  },
};
const RUN = 'https://github.com/zenfully-org/zen-recorder/actions/runs/1';
const run = (headBranch: string, status: string) => ({ headBranch, status, url: RUN });

describe('judgePublishStart', () => {
  it('starts the publish mode once addons.mozilla.org made the version public', () => {
    expect(
      judgePublishStart({
        version: '0.5.0',
        channel: 'listed',
        amo: approved,
        runs: [run('v0.5.0', 'completed'), run('main', 'in_progress')],
      }),
    ).toEqual({ verdict: 'start' });
  });

  it('waits while addons.mozilla.org keeps the version to its reviewers', () => {
    expect(
      judgePublishStart({ version: '0.5.0', channel: 'listed', amo: UNAUTHORIZED, runs: [] }),
    ).toEqual({
      verdict: 'wait',
      reason:
        'addons.mozilla.org has not made 0.5.0 public yet: it answers 401 without the API key until a reviewer approves it',
    });
  });

  it('waits while addons.mozilla.org does not have the version yet', () => {
    expect(
      judgePublishStart({
        version: '0.5.0',
        channel: 'listed',
        amo: { status: 404, answer: { detail: 'Not found.' } },
        runs: [],
      }),
    ).toEqual({
      verdict: 'wait',
      reason: 'addons.mozilla.org has no version 0.5.0: the release has not submitted it yet',
    });
  });

  it.each(['waiting', 'queued', 'in_progress', 'pending', 'requested'])(
    'starts nothing while a run on the tag is %s, so the maintainer is never asked twice',
    (status) => {
      expect(
        judgePublishStart({
          version: '0.5.0',
          channel: 'listed',
          amo: approved,
          runs: [run('v0.5.0', status)],
        }),
      ).toEqual({
        verdict: 'wait',
        reason: `a release run on v0.5.0 has not finished (${status}): ${RUN}`,
      });
    },
  );

  it('leaves an unlisted release to the maintainer: addons.mozilla.org shows no unlisted version without the key', () => {
    expect(
      judgePublishStart({ version: '0.5.0', channel: 'unlisted', amo: UNAUTHORIZED, runs: [] }),
    ).toEqual({
      verdict: 'wait',
      reason:
        'addons.mozilla.org shows unlisted versions to their developers only: once it signed 0.5.0, run the release workflow on v0.5.0 in the publish mode',
    });
  });

  it('waits when the public version is not the one asked for', () => {
    expect(
      judgePublishStart({
        version: '0.5.0',
        channel: 'listed',
        amo: { status: 200, answer: { ...approved.answer, version: '0.5.1' } },
        runs: [],
      }),
    ).toEqual({
      verdict: 'wait',
      reason: 'addons.mozilla.org answered with 0.5.1 for 0.5.0',
    });
  });

  it.each([
    { name: 'an error of its own', amo: { status: 503, answer: 'Service Unavailable' } },
    {
      name: 'a refusal for too many requests',
      amo: { status: 429, answer: { detail: 'slow down' } },
    },
  ])('fails on $name, so the run shows it', ({ amo }) => {
    expect(judgePublishStart({ version: '0.5.0', channel: 'listed', amo, runs: [] })).toEqual({
      verdict: 'fail',
      reason: `addons.mozilla.org answered ${amo.status} for 0.5.0: ${JSON.stringify(amo.answer)}`,
    });
  });
});
