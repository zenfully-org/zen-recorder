/**
 * What git knows of a working copy, for the checks that read files themselves. A working copy may
 * hold files that never reach the repository: scratch folders, copies, clones of other projects,
 * ignored through `.gitignore`, `.git/info/exclude` or the user's global rules. The conventions
 * check and the test runner read what git tracks or would add, and leave out what it ignores, as
 * Biome, `tsc` and the sources zip already do.
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

const gitList = (root: string, args: string[], pathspecs: string[]): string[] =>
  execFileSync('git', ['ls-files', '-z', ...args, '--', ...pathspecs], {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
    .split('\0')
    .filter((file) => file !== '');

/**
 * The files under `pathspecs` that git tracks (staged new ones included) or would add (untracked
 * and covered by no ignore rule), and that are on disk, relative to `root`. A module written but
 * not staged yet is listed; a file in an ignored folder is not.
 */
export function listProjectFiles(root: string, pathspecs: string[]): string[] {
  return gitList(root, ['--cached', '--others', '--exclude-standard'], pathspecs).filter((file) =>
    existsSync(path.join(root, file)),
  );
}

/** A path as a glob that matches only itself: `*`, `?`, brackets and the like taken literally. */
const literalGlob = (file: string): string => file.replace(/[*?()[\]{}!+@\\]/g, '\\$&');

/**
 * The files git ignores under `pathspecs`, relative to `root`, each as a glob that matches only
 * itself, for a tool's `exclude`. None outside a git working copy.
 */
export function listIgnoredFiles(root: string, pathspecs: string[]): string[] {
  try {
    return gitList(root, ['--others', '--ignored', '--exclude-standard'], pathspecs).map(
      literalGlob,
    );
  } catch {
    return [];
  }
}
