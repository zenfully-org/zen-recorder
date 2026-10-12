// @vitest-environment node
/**
 * An hourly check finishes a release whose signing outlasted the release workflow's wait: it looks
 * at the newest release, and only an unsigned pre-release the release workflow published is one
 * to finish. Everything else is left alone, with the reason.
 */
import { findUnsignedPreRelease } from './find-unsigned-pre-release';

const preRelease = (version: string) => ({
  tag: `v${version}`,
  draft: false,
  prerelease: true,
  assets: [`zen-recorder-${version}-sources.zip`, `zen-recorder-${version}-unsigned.xpi`],
});
const released = (version: string) => ({
  tag: `v${version}`,
  draft: false,
  prerelease: false,
  assets: [`zen-recorder-${version}-sources.zip`, `zen-recorder-${version}.xpi`],
});

describe('findUnsignedPreRelease', () => {
  it('finds the newest release when it is an unsigned pre-release', () => {
    expect(findUnsignedPreRelease([preRelease('0.5.0'), released('0.4.1')])).toEqual({
      found: true,
      tag: 'v0.5.0',
      version: '0.5.0',
    });
  });

  it('takes the newest by version, not by the order GitHub lists them in', () => {
    expect(findUnsignedPreRelease([released('0.9.0'), preRelease('0.10.0')])).toMatchObject({
      found: true,
      version: '0.10.0',
    });
  });

  it('leaves a signed release alone, even with an older pre-release still waiting', () => {
    expect(findUnsignedPreRelease([preRelease('0.5.0'), released('0.6.0')])).toEqual({
      found: false,
      reason: 'v0.6.0, the newest release, is signed already: nothing to finish',
    });
  });

  it('skips drafts, which nobody can download', () => {
    expect(
      findUnsignedPreRelease([
        { tag: 'v0.6.0', draft: true, prerelease: false, assets: [] },
        preRelease('0.5.0'),
      ]),
    ).toMatchObject({ found: true, version: '0.5.0' });
  });

  it('leaves alone a pre-release without the unsigned XPI, which the release workflow did not publish', () => {
    expect(
      findUnsignedPreRelease([
        { tag: 'v0.5.0-beta.1', draft: false, prerelease: true, assets: [] },
        { tag: 'v0.5.0', draft: false, prerelease: true, assets: ['notes.txt'] },
      ]),
    ).toEqual({
      found: false,
      reason:
        'v0.5.0 is a pre-release without zen-recorder-0.5.0-unsigned.xpi: not one the release workflow published',
    });
  });

  it('ignores releases whose tag is not a version', () => {
    expect(
      findUnsignedPreRelease([
        { tag: 'nightly', draft: false, prerelease: true, assets: [] },
        preRelease('0.5.0'),
      ]),
    ).toMatchObject({ found: true, version: '0.5.0' });
  });

  it('leaves 0.4.0 to be finished by hand: its tag predates the workflow that finishes a pre-release', () => {
    expect(findUnsignedPreRelease([preRelease('0.4.0')])).toEqual({
      found: false,
      reason:
        'v0.4.0 was tagged before the release workflow could finish a pre-release: it is finished by hand',
    });
  });

  it('says when there is no release yet', () => {
    expect(findUnsignedPreRelease([])).toEqual({ found: false, reason: 'there is no release yet' });
  });
});
