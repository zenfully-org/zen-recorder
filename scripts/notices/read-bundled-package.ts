import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';

const PackageJson = z.object({
  name: z.string().min(1),
  version: z.string().min(1),
  // A string is an SPDX expression; the deprecated object and array forms are not read.
  license: z.unknown().optional(),
  repository: z.unknown().optional(),
});
const Repository = z.union([z.string(), z.object({ url: z.string() })]);

/** LICENSE, LICENCE or COPYING, in any case and with any suffix (`.md`, `-MIT.txt`). */
const LICENCE_FILE = /^(?:licen[cs]e|copying)/i;

export interface BundledPackage {
  name: string;
  version: string;
  /** The `license` field, an SPDX expression, or undefined when the package names none. */
  licence: string | undefined;
  /**
   * The package's licence files, or the project's copy of the one in its repository when the
   * package publishes none (`from: 'project'`).
   */
  licenceText: { text: string; from: 'package' | 'project' } | undefined;
  /** The `repository` address when it is a plain https URL, without `git+` and `.git`. */
  repository: string | undefined;
}

/** Unix line ends and no blank lines around it, so every platform writes the same notices. */
const readText = (file: string): string =>
  readFileSync(file, 'utf8').replace(/\r\n?/g, '\n').trim();

function readLicenceText(dir: string, copy: string): BundledPackage['licenceText'] {
  const files = readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && LICENCE_FILE.test(entry.name))
    .map((entry) => entry.name)
    .sort();
  if (files.length > 0) {
    const text = files.map((file) => readText(path.join(dir, file))).join('\n\n');
    return { text, from: 'package' };
  }
  return existsSync(copy) ? { text: readText(copy), from: 'project' } : undefined;
}

function readRepository(repository: unknown): string | undefined {
  const parsed = Repository.safeParse(repository).data;
  const url = typeof parsed === 'string' ? parsed : parsed?.url;
  const https = url?.replace(/^git\+/, '').replace(/\.git$/, '');
  return https?.startsWith('https://') ? https : undefined;
}

/**
 * What the third-party notices say about the installed package in `dir`. `licenceTexts` is the
 * project's folder of licence texts for packages that publish none, laid out like node_modules:
 * `<licenceTexts>/<name>/LICENSE`. Throws when `package.json` names no package and version.
 */
export function readBundledPackage(dir: string, licenceTexts: string): BundledPackage {
  const file = path.join(dir, 'package.json');
  const parsed = PackageJson.safeParse(JSON.parse(readFileSync(file, 'utf8')));
  if (!parsed.success) throw new Error(`${file} names no package and version`);
  const { name, version, license, repository } = parsed.data;
  return {
    name,
    version,
    licence: typeof license === 'string' ? license : undefined,
    licenceText: readLicenceText(dir, path.join(licenceTexts, name, 'LICENSE')),
    repository: readRepository(repository),
  };
}
