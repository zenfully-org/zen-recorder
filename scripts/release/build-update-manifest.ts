import { z } from 'zod';

/**
 * One version in an update manifest, in the shape Mozilla documents ("Updating your extension" on
 * extensionworkshop.com) and Gecko's `AddonUpdateChecker.sys.mjs` reads: the minimum Firefox goes
 * under `applications.gecko`, and the hash is `sha256:` plus the hex digest.
 */
const Update = z.object({
  version: z.string().min(1),
  update_link: z.url({ protocol: /^https$/ }),
  update_hash: z.string().regex(/^sha256:[0-9a-f]{64}$/),
  applications: z.object({ gecko: z.object({ strict_min_version: z.string().min(1) }) }),
});

const UpdateManifest = z.object({
  addons: z.record(z.string(), z.object({ updates: z.array(Update) })),
});

export type UpdateManifest = z.infer<typeof UpdateManifest>;

export interface Release {
  /** The add-on id, the key Firefox looks its updates up by. */
  id: string;
  version: string;
  /** The `strict_min_version` of the XPI's own manifest. */
  strictMinVersion: string;
  /** Where the signed XPI is downloaded from: HTTPS, the release's asset. */
  updateLink: string;
  /** The XPI's SHA-256, in hex. Firefox checks the download against it. */
  sha256: string;
}

const byVersion = (a: { version: string }, b: { version: string }) =>
  a.version.localeCompare(b.version, 'en', { numeric: true });

/**
 * The update manifest with one more release: the published manifest (`undefined` before the
 * first release) plus the release's entry, replacing an entry of the same version, ordered by
 * version. Earlier versions stay, so a browser too old for the newest one still finds one it can
 * run. Throws on a published manifest it cannot read, rather than starting over and dropping
 * every earlier release.
 */
export function buildUpdateManifest(previous: unknown, release: Release): UpdateManifest {
  const published =
    previous === undefined ? { addons: {} } : UpdateManifest.safeParse(previous).data;
  if (published === undefined) {
    throw new Error('the published updates.json is not an update manifest');
  }
  const update = Update.safeParse({
    version: release.version,
    update_link: release.updateLink,
    update_hash: `sha256:${release.sha256}`,
    applications: { gecko: { strict_min_version: release.strictMinVersion } },
  }).data;
  if (update === undefined) {
    throw new Error(`${JSON.stringify(release)} is not a release Firefox can update to`);
  }
  const others = (published.addons[release.id]?.updates ?? []).filter(
    (entry) => entry.version !== update.version,
  );
  return {
    addons: { ...published.addons, [release.id]: { updates: [...others, update].sort(byVersion) } },
  };
}
