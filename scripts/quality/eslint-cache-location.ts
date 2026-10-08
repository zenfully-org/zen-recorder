/**
 * Where the quality gate keeps ESLint's cache: a file under node_modules/.cache (which git ignores
 * and the sources zip leaves out), named after the lockfile's contents. ESLint drops a cached
 * result when the file's contents, ESLint's or Node.js's version, or the configuration changes,
 * but eslint-plugin-sonarjs reports its version as `0.0.0-SNAPSHOT`, so upgrading it with an
 * unchanged configuration would keep results the old plugin produced. A new lockfile means a new
 * cache file, and everything is linted again.
 */
import { createHash } from 'node:crypto';
import path from 'node:path';

export function eslintCacheLocation(root: string, lockfile: string): string {
  const key = createHash('sha256').update(lockfile).digest('hex').slice(0, 16);
  return path.join(root, 'node_modules', '.cache', 'zen-recorder', 'eslint', `${key}.json`);
}
