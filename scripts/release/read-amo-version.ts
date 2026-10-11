import { z } from 'zod';

/** What addons.mozilla.org's API says of one version of the add-on (`addon/<id>/versions/<v>/`). */
const AmoVersion = z.object({
  version: z.string(),
  channel: z.string(),
  file: z.object({ status: z.string(), url: z.string() }).nullable(),
});

export type AmoVersionReading = { ready: true; url: string } | { ready: false; reason: string };

/**
 * Whether addons.mozilla.org has the signed file of `expected.version` ready for the release: it
 * must be that version, on the channel the release signs on, with a file AMO made public (approved
 * and signed). Otherwise, why not.
 */
export function readAmoVersion(
  answer: unknown,
  expected: { version: string; channel: string },
): AmoVersionReading {
  const parsed = AmoVersion.safeParse(answer);
  if (!parsed.success) {
    return {
      ready: false,
      reason: `addons.mozilla.org did not describe version ${expected.version}: ${JSON.stringify(answer)}`,
    };
  }
  const { version, channel, file } = parsed.data;
  if (version !== expected.version) {
    return {
      ready: false,
      reason: `addons.mozilla.org answered with ${version} for ${expected.version}`,
    };
  }
  if (channel !== expected.channel) {
    return {
      ready: false,
      reason: `addons.mozilla.org has ${version} on the ${channel} channel, and this release is ${expected.channel}`,
    };
  }
  if (file === null) {
    return { ready: false, reason: `addons.mozilla.org has no file for ${version}` };
  }
  if (file.status !== 'public') {
    return {
      ready: false,
      reason: `addons.mozilla.org has not approved ${version} yet (its file is "${file.status}"): run the publish mode again once it has`,
    };
  }
  return { ready: true, url: file.url };
}
