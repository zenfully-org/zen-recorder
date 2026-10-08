// @vitest-environment node
/**
 * What the release reads from the XPI before it tells installed copies about it: the add-on id,
 * the version and the minimum Firefox from its manifest, and whether Mozilla signed it. An XPI
 * that would strand its users (another version than the tag, the wrong build for the channel AMO
 * signs it on, no signature) or that leaves out the licences it must carry is refused before
 * anything is published.
 *
 * The channel decides the build. On AMO's unlisted channel the release is the self-distributed
 * build, which names its own update manifest: without one, a copy never hears of the next
 * release. On the listed channel AMO refuses an XPI that names one, and Firefox updates the copy
 * from addons.mozilla.org instead.
 */
import { getAddOnId } from '../../src/lib/get-add-on-id';
import { getGeckoSettings } from './get-gecko-settings';
import { readReleaseXpi } from './read-release-xpi';

const NOTICES = ['LICENSE', 'THIRD-PARTY-NOTICES.md'];
const SIGNED_ENTRIES = [
  'manifest.json',
  'background.js',
  ...NOTICES,
  'META-INF/cose.manifest',
  'META-INF/cose.sig',
  'META-INF/manifest.mf',
  'META-INF/mozilla.sf',
  'META-INF/mozilla.rsa',
];
const UNSIGNED_ENTRIES = ['manifest.json', 'background.js', ...NOTICES];

const manifestOf = (channel: string | undefined, change: Record<string, unknown> = {}) => ({
  manifest_version: 3,
  name: 'Zen Recorder',
  version: '0.4.0',
  browser_specific_settings: { gecko: getGeckoSettings(channel) },
  ...change,
});
const selfManifest = (change: Record<string, unknown> = {}) => manifestOf('self', change);
const listedManifest = () => manifestOf(undefined);

describe('readReleaseXpi', () => {
  it('reads the id, the version, the minimum Firefox and the update manifest of a signed build', () => {
    expect(
      readReleaseXpi({
        manifest: selfManifest(),
        entries: SIGNED_ENTRIES,
        version: '0.4.0',
        signed: true,
        channel: 'unlisted',
      }),
    ).toEqual({
      id: getAddOnId(),
      version: '0.4.0',
      strictMinVersion: '140.0',
      updateUrl: getGeckoSettings('self').update_url,
    });
  });

  it('takes an unsigned build when the caller only previews the release', () => {
    expect(
      readReleaseXpi({
        manifest: selfManifest(),
        entries: UNSIGNED_ENTRIES,
        version: '0.4.0',
        signed: false,
        channel: 'unlisted',
      }).version,
    ).toBe('0.4.0');
  });

  it.each([
    {
      name: 'the COSE signature only',
      entries: ['manifest.json', ...NOTICES, 'META-INF/cose.sig'],
    },
    {
      name: 'the PKCS#7 signature only',
      entries: ['manifest.json', ...NOTICES, 'META-INF/mozilla.rsa'],
    },
  ])('counts a build carrying $name as signed', ({ entries }) => {
    expect(() =>
      readReleaseXpi({
        manifest: selfManifest(),
        entries,
        version: '0.4.0',
        signed: true,
        channel: 'unlisted',
      }),
    ).not.toThrow();
  });

  it('refuses an unsigned build where Mozilla must have signed it, since release Firefox would not install it', () => {
    expect(() =>
      readReleaseXpi({
        manifest: selfManifest(),
        entries: UNSIGNED_ENTRIES,
        version: '0.4.0',
        signed: true,
        channel: 'unlisted',
      }),
    ).toThrow('the XPI is not signed (no META-INF/cose.sig or META-INF/mozilla.rsa)');
  });

  it('refuses a build of another version than the release', () => {
    expect(() =>
      readReleaseXpi({
        manifest: selfManifest({ version: '0.3.0' }),
        entries: SIGNED_ENTRIES,
        version: '0.4.0',
        signed: true,
        channel: 'unlisted',
      }),
    ).toThrow('the XPI is version 0.3.0, not 0.4.0');
  });

  it('refuses an unlisted build without an update manifest, whose users would never see the next release', () => {
    expect(() =>
      readReleaseXpi({
        manifest: listedManifest(),
        entries: SIGNED_ENTRIES,
        version: '0.4.0',
        signed: true,
        channel: 'unlisted',
      }),
    ).toThrow(
      'the XPI names no update_url, so a copy installed from it would never update: ' +
        'build the unlisted release with ZEN_RECORDER_CHANNEL=self',
    );
  });

  it('takes a listed build without an update manifest, since Firefox updates it from addons.mozilla.org', () => {
    expect(
      readReleaseXpi({
        manifest: listedManifest(),
        entries: SIGNED_ENTRIES,
        version: '0.4.0',
        signed: true,
        channel: 'listed',
      }),
    ).toEqual({
      id: getAddOnId(),
      version: '0.4.0',
      strictMinVersion: '140.0',
      updateUrl: undefined,
    });
  });

  it('refuses a listed build that names an update manifest, which addons.mozilla.org refuses on that channel', () => {
    expect(() =>
      readReleaseXpi({
        manifest: selfManifest(),
        entries: SIGNED_ENTRIES,
        version: '0.4.0',
        signed: true,
        channel: 'listed',
      }),
    ).toThrow(
      'the XPI names an update_url, which addons.mozilla.org refuses on the listed channel: ' +
        'build the listed release without ZEN_RECORDER_CHANNEL',
    );
  });

  it.each(NOTICES)(
    'refuses a build without %s, which the licences of the project and of what it bundles ask for',
    (file) => {
      expect(() =>
        readReleaseXpi({
          manifest: selfManifest(),
          entries: SIGNED_ENTRIES.filter((entry) => entry !== file),
          version: '0.4.0',
          signed: true,
          channel: 'unlisted',
        }),
      ).toThrow(`the XPI has no ${file}, which every build of the extension writes`);
    },
  );

  it('refuses a build of another add-on', () => {
    expect(() =>
      readReleaseXpi({
        manifest: selfManifest({
          browser_specific_settings: {
            gecko: { ...getGeckoSettings('self'), id: 'someone-else@example.org' },
          },
        }),
        entries: SIGNED_ENTRIES,
        version: '0.4.0',
        signed: true,
        channel: 'unlisted',
      }),
    ).toThrow(`the XPI is the add-on someone-else@example.org, not ${getAddOnId()}`);
  });

  it.each([
    { name: 'no manifest at all', manifest: undefined },
    { name: 'a manifest without a version', manifest: selfManifest({ version: undefined }) },
    { name: 'a manifest without Firefox settings', manifest: { version: '0.4.0' } },
  ])('refuses $name', ({ manifest }) => {
    expect(() =>
      readReleaseXpi({
        manifest,
        entries: SIGNED_ENTRIES,
        version: '0.4.0',
        signed: true,
        channel: 'unlisted',
      }),
    ).toThrow('the XPI has no manifest.json of a Firefox add-on');
  });
});
