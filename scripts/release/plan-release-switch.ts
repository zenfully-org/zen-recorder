import type { ListedRelease } from './parse-release-list';

export type ReleaseSwitch =
  | {
      ok: true;
      /** Attached files to delete: the unsigned XPI, once the signed one is there. */
      deleteAssets: string[];
      /** How to publish it, or `undefined` for a release that is published already. */
      publish: { title: string; latest: boolean } | undefined;
    }
  | { ok: false; problem: string };

const isNewer = (a: string, b: string) => a.localeCompare(b, 'en', { numeric: true }) > 0;

/**
 * How the GitHub Release of `version` turns into the release once the signed XPI is attached to
 * it: the unsigned XPI of its pre-release is deleted, and a pre-release (or a draft) is published
 * under its plain title, marked latest unless a newer version is published already, since
 * `releases/latest` must name the newest signed release. A release that is published already is
 * left as it is, so running it again changes nothing. Refuses before the signed XPI is attached.
 */
export function planReleaseSwitch(input: {
  version: string;
  releases: readonly ListedRelease[];
}): ReleaseSwitch {
  const tag = `v${input.version}`;
  const release = input.releases.find((candidate) => candidate.tag === tag);
  if (release === undefined) {
    return {
      ok: false,
      problem: `there is no release ${tag}: the release mode publishes its pre-release first`,
    };
  }
  const signed = `zen-recorder-${input.version}.xpi`;
  if (!release.assets.includes(signed)) {
    return { ok: false, problem: `${tag} has no ${signed} attached: attach the signed XPI first` };
  }
  const unsigned = `zen-recorder-${input.version}-unsigned.xpi`;
  const newerReleased = input.releases.some(
    (other) => !other.draft && !other.prerelease && isNewer(other.tag, tag),
  );
  return {
    ok: true,
    deleteAssets: release.assets.filter((asset) => asset === unsigned),
    publish:
      release.draft || release.prerelease
        ? { title: `Zen Recorder ${input.version}`, latest: !newerReleased }
        : undefined,
  };
}
