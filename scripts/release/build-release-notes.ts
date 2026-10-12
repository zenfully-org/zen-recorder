const PLACEHOLDERS = ['{version}', '{sha256}'];
const SHA256 = /^[0-9a-f]{64}$/;

/**
 * The notes of a version's GitHub Release: its changelog section (`changes`, as
 * `scripts/release-notes.sh` prints it), a blank line and the install steps (`footer`,
 * `.github/release-notes-footer.md`). A pre-release, which offers the unsigned XPI until Mozilla
 * signed it, opens with `preRelease.notice` (`.github/pre-release-notice.md`), its `{version}` and
 * `{sha256}` filled in. Throws on a notice that would leave a placeholder or a wrong hash in the
 * published notes.
 */
export function buildReleaseNotes(input: {
  changes: string;
  footer: string;
  preRelease?: { notice: string; version: string; sha256: string } | undefined;
}): string {
  const parts = [input.changes, input.footer];
  if (input.preRelease !== undefined) {
    const { notice, version, sha256 } = input.preRelease;
    const missing = PLACEHOLDERS.find((placeholder) => !notice.includes(placeholder));
    if (missing !== undefined) throw new Error(`the pre-release notice names no ${missing}`);
    const unknown = notice.match(/\{\w+\}/g)?.find((found) => !PLACEHOLDERS.includes(found));
    if (unknown !== undefined) {
      throw new Error(`the pre-release notice has an unknown placeholder ${unknown}`);
    }
    if (!SHA256.test(sha256)) throw new Error(`"${sha256}" is not a SHA-256 in hex`);
    parts.unshift(notice.replaceAll('{version}', version).replaceAll('{sha256}', sha256));
  }
  return `${parts.map((part) => part.trimEnd()).join('\n\n')}\n`;
}
