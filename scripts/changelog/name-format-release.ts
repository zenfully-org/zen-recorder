/**
 * Names a release in the meeting notes format's changelog (docs/meeting-notes-format.md): the
 * line of a version no release wrote yet, `- **1.2** (unreleased): …`, becomes
 * `- **1.2** (Zen Recorder 0.6.0): …` in the release that first writes it. A line that names a
 * release already stays as it is: that release wrote the version first.
 */

export function nameFormatRelease(doc: string, formatVersion: string, release: string): string {
  const prefix = `- **${formatVersion}** (`;
  const lines = doc.split('\n');
  const index = lines.findIndex((line) => line.startsWith(prefix));
  if (index === -1) {
    throw new Error(
      `docs/meeting-notes-format.md has no changelog line for format ${formatVersion} ("${prefix}…")`,
    );
  }
  const unreleased = `${prefix}unreleased)`;
  return lines
    .map((line, at) =>
      at === index && line.startsWith(unreleased)
        ? `${prefix}Zen Recorder ${release})${line.slice(unreleased.length)}`
        : line,
    )
    .join('\n');
}
