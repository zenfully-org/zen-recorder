import type { ListedRelease } from './parse-release-list';

const VERSION_TAG = /^v(\d+\.\d+\.\d+)$/;
/**
 * The last version tagged before the release workflow could finish a pre-release. A run on a tag
 * runs the workflow as of that tag, so its publish mode could not switch it: it is finished by
 * hand.
 */
const LAST_FINISHED_BY_HAND = '0.4.0';

const compare = (a: string, b: string) => a.localeCompare(b, 'en', { numeric: true });

export type UnsignedPreRelease =
  | { found: true; tag: string; version: string }
  | { found: false; reason: string };

/**
 * The release to finish once Mozilla signed it: the newest published release (by version, drafts
 * and tags that are no version left out), when it is a pre-release carrying the unsigned XPI the
 * release workflow attaches. Otherwise, why there is none.
 */
export function findUnsignedPreRelease(releases: readonly ListedRelease[]): UnsignedPreRelease {
  const newest = releases
    .filter((release) => !release.draft)
    .flatMap((release) => {
      const version = VERSION_TAG.exec(release.tag)?.[1];
      return version === undefined ? [] : [{ ...release, version }];
    })
    .sort((a, b) => compare(b.version, a.version))[0];
  if (newest === undefined) return { found: false, reason: 'there is no release yet' };
  const { tag, version } = newest;
  if (!newest.prerelease) {
    return {
      found: false,
      reason: `${tag}, the newest release, is signed already: nothing to finish`,
    };
  }
  const unsigned = `zen-recorder-${version}-unsigned.xpi`;
  if (!newest.assets.includes(unsigned)) {
    return {
      found: false,
      reason: `${tag} is a pre-release without ${unsigned}: not one the release workflow published`,
    };
  }
  if (compare(version, LAST_FINISHED_BY_HAND) <= 0) {
    return {
      found: false,
      reason: `${tag} was tagged before the release workflow could finish a pre-release: it is finished by hand`,
    };
  }
  return { found: true, tag, version };
}
