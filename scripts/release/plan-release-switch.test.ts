// @vitest-environment node
/**
 * Once Mozilla signed a version's XPI and the release workflow attached it, the version's GitHub
 * Release turns from the unsigned pre-release into the release: the unsigned file goes, the title
 * loses "(unsigned pre-release)", and it becomes the latest release, which `releases/latest`
 * points at. Running it again on a finished release changes nothing, and it never makes an older
 * version the latest.
 */
import { planReleaseSwitch } from './plan-release-switch';

const preRelease = (tag: string, assets: string[]) => ({
  tag,
  draft: false,
  prerelease: true,
  assets,
});
const released = (tag: string, assets: string[] = []) => ({
  tag,
  draft: false,
  prerelease: false,
  assets,
});
const SIGNED = ['zen-recorder-0.5.0-sources.zip', 'zen-recorder-0.5.0.xpi'];
const BOTH = [...SIGNED, 'zen-recorder-0.5.0-unsigned.xpi'];

describe('planReleaseSwitch', () => {
  it('turns the pre-release into the latest release without the unsigned file once the signed one is attached', () => {
    expect(
      planReleaseSwitch({
        version: '0.5.0',
        releases: [preRelease('v0.5.0', BOTH), released('v0.4.0')],
      }),
    ).toEqual({
      ok: true,
      deleteAssets: ['zen-recorder-0.5.0-unsigned.xpi'],
      publish: { title: 'Zen Recorder 0.5.0', latest: true },
    });
  });

  it('publishes a draft the same way, as the release workflow made them before pre-releases', () => {
    expect(
      planReleaseSwitch({
        version: '0.5.0',
        releases: [{ tag: 'v0.5.0', draft: true, prerelease: false, assets: SIGNED }],
      }),
    ).toEqual({
      ok: true,
      deleteAssets: [],
      publish: { title: 'Zen Recorder 0.5.0', latest: true },
    });
  });

  it('makes the first release the latest', () => {
    expect(
      planReleaseSwitch({ version: '0.5.0', releases: [preRelease('v0.5.0', BOTH)] }),
    ).toMatchObject({ ok: true, publish: { latest: true } });
  });

  it('leaves the latest release alone when a newer version is out already, so releases/latest never goes back', () => {
    expect(
      planReleaseSwitch({
        version: '0.5.0',
        releases: [released('v0.10.0'), preRelease('v0.5.0', BOTH), released('v0.4.0')],
      }),
    ).toEqual({
      ok: true,
      deleteAssets: ['zen-recorder-0.5.0-unsigned.xpi'],
      publish: { title: 'Zen Recorder 0.5.0', latest: false },
    });
  });

  it('counts only signed releases as newer: a newer pre-release or draft is not the latest yet', () => {
    expect(
      planReleaseSwitch({
        version: '0.5.0',
        releases: [
          preRelease('v0.6.0', ['zen-recorder-0.6.0-unsigned.xpi']),
          { tag: 'v0.7.0', draft: true, prerelease: false, assets: [] },
          preRelease('v0.5.0', BOTH),
        ],
      }),
    ).toMatchObject({ ok: true, publish: { latest: true } });
  });

  it('changes nothing on a release that is finished already, so the publish mode can run again', () => {
    expect(
      planReleaseSwitch({
        version: '0.5.0',
        releases: [released('v0.6.0'), released('v0.5.0', SIGNED)],
      }),
    ).toEqual({ ok: true, deleteAssets: [], publish: undefined });
  });

  it('still removes an unsigned file left on a finished release', () => {
    expect(planReleaseSwitch({ version: '0.5.0', releases: [released('v0.5.0', BOTH)] })).toEqual({
      ok: true,
      deleteAssets: ['zen-recorder-0.5.0-unsigned.xpi'],
      publish: undefined,
    });
  });

  it('refuses to switch before the signed file is attached, so the release never offers no file', () => {
    expect(
      planReleaseSwitch({
        version: '0.5.0',
        releases: [
          preRelease('v0.5.0', [
            'zen-recorder-0.5.0-sources.zip',
            'zen-recorder-0.5.0-unsigned.xpi',
          ]),
        ],
      }),
    ).toEqual({
      ok: false,
      problem: 'v0.5.0 has no zen-recorder-0.5.0.xpi attached: attach the signed XPI first',
    });
  });

  it('refuses a version without a release', () => {
    expect(planReleaseSwitch({ version: '0.5.0', releases: [released('v0.4.0')] })).toEqual({
      ok: false,
      problem: 'there is no release v0.5.0: the release mode publishes its pre-release first',
    });
  });
});
