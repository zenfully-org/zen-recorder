/**
 * Adds a release's section to CHANGELOG.md: `## <version> - <date>` and its groups, right below
 * `## Unreleased`, which keeps its note, and above the releases before it, newest first.
 */

export function insertReleaseSection(
  changelog: string,
  version: string,
  date: string,
  groups: string,
): string {
  const lines = changelog.split('\n');
  const unreleased = lines.indexOf('## Unreleased');
  if (unreleased === -1) throw new Error('CHANGELOG.md has no "## Unreleased" section');
  if (lines.some((line) => line === `## ${version}` || line.startsWith(`## ${version} - `))) {
    throw new Error(`CHANGELOG.md already has a section for ${version}`);
  }
  const next = lines.findIndex((line, index) => index > unreleased && line.startsWith('## '));
  const section = [`## ${version} - ${date}`, '', ...groups.split('\n'), ''];
  if (next === -1) {
    const body = lines.slice(0, lines.at(-1) === '' ? -1 : undefined);
    return [...body, '', ...section].join('\n');
  }
  return [...lines.slice(0, next), ...section, ...lines.slice(next)].join('\n');
}
