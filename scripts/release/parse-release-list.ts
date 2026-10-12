import { z } from 'zod';

const ReleaseList = z.array(
  z.object({
    tag_name: z.string(),
    draft: z.boolean(),
    prerelease: z.boolean(),
    assets: z.array(z.object({ name: z.string() })),
  }),
);

/** A GitHub Release of the repository, as the release workflow reads it. */
export interface ListedRelease {
  tag: string;
  draft: boolean;
  prerelease: boolean;
  /** The names of the files attached to it. */
  assets: readonly string[];
}

/**
 * The releases in GitHub's answer to `GET repos/<repo>/releases`. Throws on an answer that is not
 * a list of releases.
 */
export function parseReleaseList(answer: unknown): ListedRelease[] {
  const parsed = ReleaseList.safeParse(answer);
  if (!parsed.success) {
    throw new Error(`GitHub's answer is not a list of releases: ${JSON.stringify(answer)}`);
  }
  return parsed.data.map((release) => ({
    tag: release.tag_name,
    draft: release.draft,
    prerelease: release.prerelease,
    assets: release.assets.map((asset) => asset.name),
  }));
}
