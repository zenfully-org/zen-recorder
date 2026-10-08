// @vitest-environment node
/**
 * The manifest's permissions are written once, here, and `docs/store/permissions.md` says why the
 * extension needs each one: addons.mozilla.org's reviewers read it with the submission, and anyone
 * deciding whether to install can too. These tests fail when the two disagree, in either direction.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { getProviderCatalog } from '../providers/get-provider-catalog';
import { getManifestPermissions } from './get-manifest-permissions';

const ROOT = path.resolve(import.meta.dirname, '../../..');

/** The text under the `## <heading>` of a Markdown file, up to the next `## `. */
function section(markdown: string, heading: string): string {
  return markdown.split(`\n## ${heading}\n`)[1]?.split('\n## ')[0] ?? '';
}

const justifications = (): string =>
  readFileSync(path.join(ROOT, 'docs/store/permissions.md'), 'utf8');

/** The notes to reviewer of a listed version, the fenced block of `docs/store/listing.md`. */
const reviewerNotes = (): string =>
  /```text\n([\s\S]*?)\n```/.exec(
    section(readFileSync(path.join(ROOT, 'docs/store/listing.md'), 'utf8'), 'Notes to reviewer'),
  )?.[1] ?? '';

describe('getManifestPermissions', () => {
  it('asks for the API permissions the extension uses, in the order the manifest lists them', () => {
    expect(getManifestPermissions()).toEqual([
      'storage',
      'unlimitedStorage',
      'downloads',
      'notifications',
      'alarms',
    ]);
  });

  it('has a justification in docs/store/permissions.md for each API permission, and for no other', () => {
    const justified = [...section(justifications(), 'API permissions').matchAll(/^### `(\w+)`$/gm)]
      .map((match) => match[1])
      .sort();

    expect(justified).toEqual([...getManifestPermissions()].sort());
  });

  it('has a justification in docs/store/permissions.md for each site it runs on, and for no other', () => {
    const justified = [
      ...section(justifications(), 'Host permissions').matchAll(/^\| `(https:\/\/[^`]+)` \|/gm),
    ]
      .map((match) => match[1])
      .sort();

    expect(justified).toEqual(
      getProviderCatalog()
        .flatMap((provider) => provider.origins)
        .sort(),
    );
  });

  it('names each API permission in the notes to reviewer of docs/store/listing.md, and no other', () => {
    const named = [...reviewerNotes().matchAll(/^- (\w+): /gm)].map((match) => match[1]).sort();

    expect(named).toEqual([...getManifestPermissions()].sort());
  });
});
