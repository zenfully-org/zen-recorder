export interface PackageNotice {
  name: string;
  version: string;
  /** The package's SPDX licence expression. */
  licence: string;
  /** Its licence text, from the package or, when it publishes none, from its repository. */
  licenceText: { text: string; from: 'package' | 'project' };
  /** Where a library under the MPL keeps its source (MPL-2.0 section 3.2(a)); otherwise unset. */
  source: string | undefined;
}

const byNameThenVersion = (a: PackageNotice, b: PackageNotice): number => {
  if (a.name !== b.name) return a.name < b.name ? -1 : 1;
  return a.version.localeCompare(b.version, 'en', { numeric: true });
};

/** A code fence longer than any run of backticks in the text, so the text shows as it is. */
function fence(text: string): string {
  const longest = Math.max(0, ...(text.match(/`+/g) ?? []).map((run) => run.length));
  const marks = '`'.repeat(Math.max(3, longest + 1));
  return `${marks}text\n${text}\n${marks}`;
}

function renderEntry(notice: PackageNotice): string {
  const about = [`Licence: ${notice.licence}.`];
  if (notice.source !== undefined) {
    about.push(`Its source code is at ${notice.source} (version ${notice.version}).`);
  }
  if (notice.licenceText.from === 'project') {
    about.push('The npm package publishes no licence file; this is the one in its repository.');
  }
  return [
    `## ${notice.name} ${notice.version}`,
    '',
    about.join(' '),
    '',
    fence(notice.licenceText.text),
    '',
  ].join('\n');
}

/**
 * `THIRD-PARTY-NOTICES.md`, shipped in the extension next to its `LICENSE`: the packages it
 * bundles in a table, then each one's licence and licence text, and for a library under the MPL
 * where its source is. Packages are ordered by name, then version, so the file depends on nothing
 * but the packages.
 */
export function renderThirdPartyNotices(
  project: { name: string; version: string },
  notices: readonly PackageNotice[],
): string {
  const sorted = [...notices].sort(byNameThenVersion);
  return [
    '# Third-party notices',
    '',
    `${project.name} ${project.version} is under the MIT licence, in the file LICENSE next to this one. It bundles the ${sorted.length} open-source packages below, which keep their own licences. Each one’s licence text follows the list.`,
    '',
    '| Package | Version | Licence |',
    '| --- | --- | --- |',
    ...sorted.map((notice) => `| ${notice.name} | ${notice.version} | ${notice.licence} |`),
    '',
    ...sorted.map(renderEntry),
  ].join('\n');
}
