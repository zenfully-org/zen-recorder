/**
 * Which build e2e scenario 88 updates from: the newest release, read from
 * `git ls-remote --tags --refs --sort=-v:refname origin 'v*'` (newest first, one
 * `<commit>\trefs/tags/<name>` per line). A release is a tag `v<major>.<minor>.<patch>`; a
 * pre-release or any other tag is skipped.
 *
 * Until the first release is tagged, the first public commit stands in for it: it already carries
 * the add-on's current id, so installing today's build over it is an update, as it is for a person
 * whose copy updates itself.
 */
export const FIRST_PUBLIC_COMMIT = '91566ea5843a53e8d99a62135bc1dac21ad709cb';

const RELEASE_TAG_RE = /^([0-9a-f]{40})\trefs\/tags\/(v\d+\.\d+\.\d+)$/;

export function pickUpgradeBase(listed: string): { commit: string; name: string } {
  for (const line of listed.split('\n')) {
    const match = RELEASE_TAG_RE.exec(line.trim());
    if (match?.[1] && match[2]) return { commit: match[1], name: match[2] };
  }
  return { commit: FIRST_PUBLIC_COMMIT, name: 'the first public commit' };
}
