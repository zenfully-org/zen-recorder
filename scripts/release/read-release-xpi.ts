import { z } from 'zod';
import { getAddOnId } from '../../src/lib/get-add-on-id';

const Manifest = z.object({
  version: z.string().min(1),
  browser_specific_settings: z.object({
    gecko: z.object({
      id: z.string(),
      strict_min_version: z.string().min(1),
      update_url: z.string().optional(),
    }),
  }),
});

/** AMO signs with both; Firefox needs one of them. */
const SIGNATURES = ['META-INF/cose.sig', 'META-INF/mozilla.rsa'];
/** What the licences of the project and of the packages it bundles ask the XPI to carry. */
const NOTICES = ['LICENSE', 'THIRD-PARTY-NOTICES.md'];

/** The addons.mozilla.org channel a release is signed on, as `web-ext sign --channel` names it. */
export type AmoChannel = 'listed' | 'unlisted';

/**
 * The build each channel signs: whether its manifest names an update manifest, and what to say
 * when the XPI is the other build.
 */
const BUILD_FOR: Record<AmoChannel, { namesUpdateUrl: boolean; otherBuild: string }> = {
  unlisted: {
    namesUpdateUrl: true,
    otherBuild:
      'the XPI names no update_url, so a copy installed from it would never update: ' +
      'build the unlisted release with ZEN_RECORDER_CHANNEL=self',
  },
  listed: {
    namesUpdateUrl: false,
    otherBuild:
      'the XPI names an update_url, which addons.mozilla.org refuses on the listed channel: ' +
      'build the listed release without ZEN_RECORDER_CHANNEL',
  },
};

export interface ReleaseXpi {
  id: string;
  version: string;
  strictMinVersion: string;
  /** The update manifest the XPI names: the unlisted build's; a listed build names none. */
  updateUrl: string | undefined;
}

/**
 * What a release reads from its XPI: `manifest` is the parsed `manifest.json`, `entries` the
 * names of the files in the zip. Throws when the XPI would strand the people who install it: an
 * add-on or a version other than the release's, the wrong build for the `channel` AMO signs it on,
 * or, when `signed`, no Mozilla signature (release Firefox refuses it). An unlisted release must
 * name its own update manifest, or its users never hear of the next release; a listed one must
 * not, because AMO refuses it there and Firefox updates a listed add-on from AMO. Throws too when
 * it leaves out the project's licence or the third-party notices.
 */
export function readReleaseXpi(xpi: {
  manifest: unknown;
  entries: readonly string[];
  version: string;
  signed: boolean;
  channel: AmoChannel;
}): ReleaseXpi {
  const manifest = Manifest.safeParse(xpi.manifest).data;
  if (manifest === undefined) throw new Error('the XPI has no manifest.json of a Firefox add-on');
  const { id, strict_min_version, update_url } = manifest.browser_specific_settings.gecko;
  if (id !== getAddOnId()) throw new Error(`the XPI is the add-on ${id}, not ${getAddOnId()}`);
  if (manifest.version !== xpi.version) {
    throw new Error(`the XPI is version ${manifest.version}, not ${xpi.version}`);
  }
  const build = BUILD_FOR[xpi.channel];
  if ((update_url !== undefined) !== build.namesUpdateUrl) throw new Error(build.otherBuild);
  const missing = NOTICES.find((file) => !xpi.entries.includes(file));
  if (missing !== undefined) {
    throw new Error(`the XPI has no ${missing}, which every build of the extension writes`);
  }
  if (xpi.signed && !SIGNATURES.some((file) => xpi.entries.includes(file))) {
    throw new Error(`the XPI is not signed (no ${SIGNATURES.join(' or ')})`);
  }
  return {
    id,
    version: manifest.version,
    strictMinVersion: strict_min_version,
    updateUrl: update_url,
  };
}
