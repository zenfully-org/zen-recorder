// @vitest-environment node
/**
 * The notes of a GitHub Release. A release is published twice: first as a pre-release with the
 * unsigned XPI as soon as its CI passed, then, once Mozilla signed the XPI, as the release with
 * the signed file. The pre-release's notes open with a notice: the file is not signed yet, which
 * browsers install it and at what cost, and the unsigned file's SHA-256. The release's notes are
 * the same without it. Both are the version's changelog section followed by the install steps.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { buildReleaseNotes } from './build-release-notes';

const REPO = path.resolve(import.meta.dirname, '../..');
const NOTICE = readFileSync(path.join(REPO, '.github/pre-release-notice.md'), 'utf8');

const CHANGES = '### Added\n\n- A feature.\n';
const FOOTER = '---\n\n### Install\n\nThe install steps.\n';
const SHA256 = '950ad2409f8d3cc3b7a3367558a114b4813948fd59b24887d077def865256b8d';

describe('buildReleaseNotes', () => {
  it('writes the changes, a blank line and the install steps for the signed release', () => {
    expect(buildReleaseNotes({ changes: CHANGES, footer: FOOTER })).toBe(
      '### Added\n\n- A feature.\n\n---\n\n### Install\n\nThe install steps.\n',
    );
  });

  it('opens the pre-release with the notice, naming the unsigned file and its SHA-256', () => {
    const notes = buildReleaseNotes({
      changes: CHANGES,
      footer: FOOTER,
      preRelease: { notice: NOTICE, version: '0.5.0', sha256: SHA256 },
    });

    const [notice = '', rest = ''] = notes.split('\n\n### Added\n');
    expect(notice).toContain('**Pre-release: not signed by Mozilla yet.**');
    expect(notice).toContain('`zen-recorder-0.5.0-unsigned.xpi`');
    expect(notice).toContain(`SHA-256 of the unsigned file: \`${SHA256}\``);
    expect(notice).not.toMatch(/\{\w+\}/);
    expect(`### Added\n${rest}`).toBe(buildReleaseNotes({ changes: CHANGES, footer: FOOTER }));
  });

  it('tells which browsers refuse the unsigned file, and that the pref it needs is for every add-on', () => {
    const notes = buildReleaseNotes({
      changes: CHANGES,
      footer: FOOTER,
      preRelease: { notice: NOTICE, version: '0.5.0', sha256: SHA256 },
    });

    expect(notes).toContain('**Firefox and Firefox Beta** refuse unsigned add-ons');
    expect(notes).toContain('`xpinstall.signatures.required` to `false`');
    expect(notes).toContain('turns off the signature check for every add-on');
    expect(notes).toContain('set the pref back to `true`');
  });

  it('keeps the notes as they are, whatever blank lines the parts end with', () => {
    expect(
      buildReleaseNotes({
        changes: `${CHANGES}\n\n`,
        footer: `${FOOTER}\n`,
        preRelease: {
          notice: 'Notice for {version}: {sha256}\n\n',
          version: '1.0.0',
          sha256: SHA256,
        },
      }),
    ).toBe(`Notice for 1.0.0: ${SHA256}\n\n${CHANGES}\n${FOOTER}`);
  });

  it.each([
    { name: 'no {version}', notice: 'Unsigned: {sha256}', problem: 'names no {version}' },
    { name: 'no {sha256}', notice: 'Version {version}', problem: 'names no {sha256}' },
    {
      name: 'a placeholder it does not know',
      notice: '{version} {sha256} {date}',
      problem: 'has an unknown placeholder {date}',
    },
  ])(
    'refuses a notice with $name, so the pre-release never shows a hole',
    ({ notice, problem }) => {
      expect(() =>
        buildReleaseNotes({
          changes: CHANGES,
          footer: FOOTER,
          preRelease: { notice, version: '0.5.0', sha256: SHA256 },
        }),
      ).toThrow(`the pre-release notice ${problem}`);
    },
  );

  it('refuses a SHA-256 that is not one, since people compare the file against it', () => {
    expect(() =>
      buildReleaseNotes({
        changes: CHANGES,
        footer: FOOTER,
        preRelease: { notice: NOTICE, version: '0.5.0', sha256: 'abc' },
      }),
    ).toThrow('"abc" is not a SHA-256 in hex');
  });
});
