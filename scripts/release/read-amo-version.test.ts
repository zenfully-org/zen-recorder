// @vitest-environment node
/**
 * addons.mozilla.org can hold a version for a manual review longer than the release waits. The
 * publish mode then finishes the release once AMO approved it, with the signed file AMO serves:
 * it asks AMO's API for the version and takes its file only when AMO made it public, on the
 * channel the release signs on.
 */
import { readAmoVersion } from './read-amo-version';

const URL = 'https://addons.mozilla.org/firefox/downloads/file/4567890/zen_recorder-0.4.0.xpi';
const answer = (file: unknown, extra: Record<string, unknown> = {}) => ({
  id: 5938211,
  version: '0.4.0',
  channel: 'listed',
  file,
  ...extra,
});

describe('readAmoVersion', () => {
  it('takes the file of an approved version', () => {
    expect(
      readAmoVersion(answer({ id: 4567890, status: 'public', url: URL }), {
        version: '0.4.0',
        channel: 'listed',
      }),
    ).toEqual({ ready: true, url: URL });
  });

  it('waits for a version AMO has not approved yet', () => {
    expect(
      readAmoVersion(answer({ id: 4567890, status: 'unreviewed', url: URL }), {
        version: '0.4.0',
        channel: 'listed',
      }),
    ).toEqual({
      ready: false,
      reason:
        'addons.mozilla.org has not approved 0.4.0 yet (its file is "unreviewed"): run the publish mode again once it has',
    });
  });

  it('refuses a version signed on the other channel', () => {
    expect(
      readAmoVersion(answer({ id: 4567890, status: 'public', url: URL }, { channel: 'unlisted' }), {
        version: '0.4.0',
        channel: 'listed',
      }),
    ).toEqual({
      ready: false,
      reason: 'addons.mozilla.org has 0.4.0 on the unlisted channel, and this release is listed',
    });
  });

  it('refuses another version than the one asked for', () => {
    expect(
      readAmoVersion(answer({ id: 1, status: 'public', url: URL }, { version: '0.4.1' }), {
        version: '0.4.0',
        channel: 'listed',
      }),
    ).toEqual({ ready: false, reason: 'addons.mozilla.org answered with 0.4.1 for 0.4.0' });
  });

  it('says when the version has no file', () => {
    expect(readAmoVersion(answer(null), { version: '0.4.0', channel: 'listed' })).toEqual({
      ready: false,
      reason: 'addons.mozilla.org has no file for 0.4.0',
    });
  });

  it('says when the answer is not a version', () => {
    expect(
      readAmoVersion({ detail: 'Not found.' }, { version: '0.4.0', channel: 'listed' }),
    ).toEqual({
      ready: false,
      reason: 'addons.mozilla.org did not describe version 0.4.0: {"detail":"Not found."}',
    });
  });
});
