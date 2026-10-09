/**
 * A changelog entry that waits for the next release: a file of its own in `changes/<group>/`, so
 * two pull requests never edit the same lines of CHANGELOG.md. A release gathers the files into
 * the changelog under its version.
 */

/** Keep a Changelog's groups that the project uses, in the order a release section lists them. */
export const CHANGE_GROUPS = ['Added', 'Changed', 'Removed', 'Fixed'] as const;

export type ChangeGroup = (typeof CHANGE_GROUPS)[number];

export interface ChangeEntry {
  group: ChangeGroup;
  /** The entry's file, relative to the repository's root, like `changes/fixed/72.md`. */
  file: string;
  /** The entry as written, without blank lines at either end or spaces at line ends. */
  text: string;
}
