// Relative imports only: wxt.config.ts loads this file without the "@" alias.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { isAllowedLicence } from './is-allowed-licence';
import { listBundledPackages } from './list-bundled-packages';
import { type BundledPackage, readBundledPackage } from './read-bundled-package';
import { type PackageNotice, renderThirdPartyNotices } from './render-third-party-notices';

/** The project's copies of licence texts that a package's npm release leaves out. */
const LICENCE_TEXTS = 'scripts/notices/licence-texts';

/** Why the extension may not ship `bundled`, or the notice it ships with it. */
function judge(bundled: BundledPackage): PackageNotice | string {
  const { name, version, licence, licenceText, repository } = bundled;
  const label = `${name} ${version}`;
  if (licence === undefined) return `${label} names no licence in its package.json`;
  if (!isAllowedLicence(licence)) {
    return `${label} is under ${licence}, which the project may not bundle`;
  }
  if (licenceText === undefined) {
    return `${label} publishes no licence file: add the one from its repository as ${LICENCE_TEXTS}/${name}/LICENSE`;
  }
  // MPL-2.0 section 3.2(a): whoever ships the executable form says where the source is.
  const mpl = /\bMPL-2\.0\b/i.test(licence);
  if (mpl && repository === undefined) {
    return `${label} is under the MPL, which asks to say where its source is, but its package.json names no https repository`;
  }
  return { name, version, licence, licenceText, source: mpl ? repository : undefined };
}

/**
 * Writes the project's `LICENSE` and `THIRD-PARTY-NOTICES.md` into the built extension in
 * `outDir`, and returns their names. `moduleIds` are the ids of every module the build's chunks
 * hold; `root` is the project folder. Throws, writing nothing, when the build bundles a package
 * the extension may not ship: one under a licence outside the allowed list (the project is MIT),
 * one without a licence or a licence text, or one under the MPL that names no repository for its
 * source. The error names every such package at once.
 */
export function writeLicenceNotices({
  root,
  outDir,
  moduleIds,
  project,
}: {
  root: string;
  outDir: string;
  moduleIds: readonly string[];
  project: { name: string; version: string };
}): string[] {
  const seen = new Set<string>();
  const judged = listBundledPackages(moduleIds)
    .map((dir) => readBundledPackage(dir, path.join(root, LICENCE_TEXTS)))
    .filter(({ name, version }) => {
      const key = `${name}@${version}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map(judge);

  const problems = judged.filter((verdict) => typeof verdict === 'string');
  if (problems.length > 0) {
    throw new Error(
      [
        'The extension bundles packages it may not ship. The project is MIT, so what it bundles must be under a permissive licence or MPL-2.0 (scripts/notices/is-allowed-licence.ts lists them), with a licence text to ship:',
        ...problems.map((problem) => `- ${problem}`),
      ].join('\n'),
    );
  }

  const notices = judged.filter((verdict) => typeof verdict !== 'string');
  mkdirSync(outDir, { recursive: true });
  // Unix line ends whatever the checkout did, so every platform ships the same bytes.
  const licence = readFileSync(path.join(root, 'LICENSE'), 'utf8').replace(/\r\n?/g, '\n');
  writeFileSync(path.join(outDir, 'LICENSE'), licence);
  writeFileSync(
    path.join(outDir, 'THIRD-PARTY-NOTICES.md'),
    renderThirdPartyNotices(project, notices),
  );
  return ['LICENSE', 'THIRD-PARTY-NOTICES.md'];
}
