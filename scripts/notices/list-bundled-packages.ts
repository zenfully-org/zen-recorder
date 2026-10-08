import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

/** The specifier of `@import "x"`, `@import url("x")` and Tailwind's `@plugin "x"`. */
const CSS_IMPORT = /(?<=@(?:import|plugin)\s+(?:url\(\s*)?["'])[^"']+(?=["'])/g;
const CSS_COMMENT = /\/\*[\s\S]*?\*\//g;

/** The id without its query (`?commonjs-proxy`, `?direct`), split into path segments. */
const segmentsOf = (id: string): string[] => id.replace(/\?.*$/s, '').split(/[\\/]/);

/** `node_modules/<name>` or `node_modules/@scope/<name>`, by the last `node_modules` of the path. */
function packageDirOf(segments: readonly string[]): string | undefined {
  const at = segments.lastIndexOf('node_modules');
  if (at === -1) return undefined;
  const nameLength = segments[at + 1]?.startsWith('@') ? 2 : 1;
  return segments.slice(0, at + 1 + nameLength).join(path.sep);
}

/** A bare specifier's package: `@scope/name/theme.css` → `@scope/name`, `name/x.css` → `name`. */
function packageNameOf(specifier: string): string {
  const parts = specifier.split('/');
  return parts.slice(0, specifier.startsWith('@') ? 2 : 1).join('/');
}

/** Where Node would find a package from `fromDir`: the nearest `node_modules/<name>` up. */
function resolvePackageDir(name: string, fromDir: string): string | undefined {
  for (let dir = fromDir; ; dir = path.dirname(dir)) {
    const candidate = path.join(dir, 'node_modules', name);
    if (existsSync(path.join(candidate, 'package.json'))) return candidate;
    if (path.dirname(dir) === dir) return undefined;
  }
}

/** The packages a project stylesheet pulls in by name; relative paths and URLs are its own. */
function listStylesheetPackages(file: string): string[] {
  const css = readFileSync(file, 'utf8').replace(CSS_COMMENT, '');
  const specifiers = css.match(CSS_IMPORT) ?? [];
  const bare = specifiers.filter((specifier) => !/^[./]|^[a-z][a-z0-9+.-]*:/i.test(specifier));
  return bare.map((specifier) => {
    const name = packageNameOf(specifier);
    const dir = resolvePackageDir(name, path.dirname(file));
    if (dir === undefined) throw new Error(`${file} imports "${name}", which is not installed`);
    return dir;
  });
}

/**
 * The folders of the installed packages whose code a build bundles, sorted, each once. `moduleIds`
 * are the ids the bundler reports for its chunks (`OutputChunk.moduleIds`): a module under
 * `node_modules` belongs to the package folder right after the last `node_modules` in its path.
 * The packages a project stylesheet imports are added too: Tailwind's compiler resolves those
 * `@import`s and `@plugin`s itself, so they never show up as modules of their own. Virtual
 * modules (ids starting with a NUL byte) hold no package code. Throws when a stylesheet imports a
 * package that is not installed, instead of leaving it out.
 */
export function listBundledPackages(moduleIds: readonly string[]): string[] {
  const dirs = moduleIds
    .filter((id) => !id.startsWith('\0'))
    .flatMap((id) => {
      const segments = segmentsOf(id);
      const dir = packageDirOf(segments);
      if (dir !== undefined) return [dir];
      return segments.at(-1)?.endsWith('.css')
        ? listStylesheetPackages(segments.join(path.sep))
        : [];
    });
  return [...new Set(dirs)].sort();
}
