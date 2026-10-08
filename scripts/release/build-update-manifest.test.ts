// @vitest-environment node
/**
 * The update manifest (`updates.json`) that installed copies of the self-distributed build read to
 * find a new version. Its shape is the one Mozilla documents in "Updating your extension"
 * (extensionworkshop.com) and that Gecko's `AddonUpdateChecker.sys.mjs` parses: per add-on id a
 * list of updates, each with `version`, `update_link`, `update_hash` and the minimum Firefox under
 * `applications.gecko`.
 */
import { z } from 'zod';
import { buildUpdateManifest } from './build-update-manifest';

const ID = 'zen-recorder@zenfully-org.github.io';
const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);
const link = (version: string) =>
  `https://github.com/zenfully-org/zen-recorder/releases/download/v${version}/zen-recorder-${version}.xpi`;

const release = (version: string, sha256 = HASH_A) => ({
  id: ID,
  version,
  strictMinVersion: '140.0',
  updateLink: link(version),
  sha256,
});

/** Mozilla's documented shape, strict: a key Firefox does not know fails the test. */
const MozillaUpdateManifest = z
  .object({
    addons: z.record(
      z.string(),
      z
        .object({
          updates: z.array(
            z
              .object({
                version: z.string().min(1),
                update_link: z.url({ protocol: /^https$/ }),
                update_hash: z.string().regex(/^sha(256|512):[0-9a-f]+$/),
                update_info_url: z.url().optional(),
                applications: z
                  .object({
                    gecko: z
                      .object({
                        strict_min_version: z.string().optional(),
                        strict_max_version: z.string().optional(),
                        advisory_max_version: z.string().optional(),
                      })
                      .strict(),
                  })
                  .strict(),
              })
              .strict(),
          ),
        })
        .strict(),
    ),
  })
  .strict();

const versionsOf = (manifest: ReturnType<typeof buildUpdateManifest>) =>
  manifest.addons[ID]?.updates.map((update) => update.version);

describe('buildUpdateManifest', () => {
  it('writes the first release as the only update of the add-on', () => {
    expect(buildUpdateManifest(undefined, release('0.4.0'))).toEqual({
      addons: {
        [ID]: {
          updates: [
            {
              version: '0.4.0',
              update_link: link('0.4.0'),
              update_hash: `sha256:${HASH_A}`,
              applications: { gecko: { strict_min_version: '140.0' } },
            },
          ],
        },
      },
    });
  });

  it('has the shape Mozilla documents for an update manifest', () => {
    const first = buildUpdateManifest(undefined, release('0.4.0'));
    const second = buildUpdateManifest(first, release('0.4.1', HASH_B));

    expect(MozillaUpdateManifest.safeParse(first).success).toBe(true);
    expect(MozillaUpdateManifest.safeParse(second).success).toBe(true);
    expect(MozillaUpdateManifest.safeParse(JSON.parse(JSON.stringify(second))).success).toBe(true);
  });

  it('keeps the earlier releases, so a browser too old for the newest still finds one it can run', () => {
    const first = buildUpdateManifest(undefined, release('0.4.0'));
    const second = buildUpdateManifest(first, release('0.5.0', HASH_B));

    expect(second.addons[ID]?.updates).toEqual([
      first.addons[ID]?.updates[0],
      {
        version: '0.5.0',
        update_link: link('0.5.0'),
        update_hash: `sha256:${HASH_B}`,
        applications: { gecko: { strict_min_version: '140.0' } },
      },
    ]);
  });

  it('orders the releases by version, comparing each number as a number', () => {
    let manifest = buildUpdateManifest(undefined, release('0.10.0'));
    for (const version of ['0.9.0', '1.0.0', '0.9.10', '0.9.2']) {
      manifest = buildUpdateManifest(manifest, release(version));
    }

    expect(versionsOf(manifest)).toEqual(['0.9.0', '0.9.2', '0.9.10', '0.10.0', '1.0.0']);
  });

  it('replaces the entry of a version published again, as a re-run after a fix by hand does', () => {
    const first = buildUpdateManifest(undefined, release('0.4.0', HASH_A));
    const again = buildUpdateManifest(first, release('0.4.0', HASH_B));

    expect(again.addons[ID]?.updates).toHaveLength(1);
    expect(again.addons[ID]?.updates[0]?.update_hash).toBe(`sha256:${HASH_B}`);
  });

  it('leaves the entries of another add-on id as they were', () => {
    const other = {
      version: '1.0',
      update_link: 'https://example.org/other-1.0.xpi',
      update_hash: `sha256:${HASH_B}`,
      applications: { gecko: { strict_min_version: '128.0' } },
    };
    const previous = { addons: { 'other@example.org': { updates: [other] } } };

    const manifest = buildUpdateManifest(previous, release('0.4.0'));

    expect(manifest.addons['other@example.org']).toEqual({ updates: [other] });
    expect(versionsOf(manifest)).toEqual(['0.4.0']);
  });

  it.each([
    { name: 'an HTML page', previous: '<!doctype html><title>404</title>' },
    { name: 'a list of add-ons', previous: { addons: [] } },
    { name: 'an update without a version', previous: { addons: { [ID]: { updates: [{}] } } } },
  ])('refuses to build on a published manifest that is $name', ({ previous }) => {
    expect(() => buildUpdateManifest(previous, release('0.4.0'))).toThrow(
      'the published updates.json is not an update manifest',
    );
  });

  it.each([
    { name: 'a link over plain HTTP', change: { updateLink: 'http://example.org/a.xpi' } },
    { name: 'a link that is no URL', change: { updateLink: 'zen-recorder-0.4.0.xpi' } },
    { name: 'a hash of the wrong length', change: { sha256: 'abc' } },
    { name: 'a hash in capitals', change: { sha256: 'A'.repeat(64) } },
    { name: 'an empty version', change: { version: '' } },
  ])('refuses $name', ({ change }) => {
    expect(() => buildUpdateManifest(undefined, { ...release('0.4.0'), ...change })).toThrow(
      'not a release Firefox can update to',
    );
  });
});
