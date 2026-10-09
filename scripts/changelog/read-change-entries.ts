/**
 * Reads the changelog entries that wait for the next release: one Markdown file each in
 * `changes/added/`, `changes/changed/`, `changes/removed/` or `changes/fixed/`. They come back in
 * the order a release lists them: by group, then by file name, numbers by value (`7.md` before
 * `10.md`), so the entries named after an issue come first, by its number. `changes/README.md`
 * says how to write one and is no entry.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { CHANGE_GROUPS, type ChangeEntry, type ChangeGroup } from './types';

const byName = (a: string, b: string) => a.localeCompare(b, 'en', { numeric: true });

function groupOf(folder: string): ChangeGroup | undefined {
  return CHANGE_GROUPS.find((group) => group.toLowerCase() === folder);
}

/** An entry's text without blank lines at either end or spaces at line ends. */
function tidy(text: string): string {
  return text
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n')
    .trim();
}

function readGroup(root: string, folder: string, group: ChangeGroup): ChangeEntry[] {
  return readdirSync(path.join(root, 'changes', folder))
    .sort(byName)
    .map((name) => {
      const file = `changes/${folder}/${name}`;
      if (!name.endsWith('.md')) throw new Error(`${file}: not a .md file`);
      const text = tidy(readFileSync(path.join(root, file), 'utf8'));
      if (text === '') throw new Error(`${file}: the entry is empty`);
      return { group, file, text };
    });
}

export function readChangeEntries(root: string): ChangeEntry[] {
  const dir = path.join(root, 'changes');
  if (!existsSync(dir)) return [];
  const folders = readdirSync(dir).filter((name) => name !== 'README.md');
  for (const name of folders) {
    if (!statSync(path.join(dir, name)).isDirectory()) {
      throw new Error(`changes/${name}: not in a group folder`);
    }
    if (!groupOf(name)) throw new Error(`changes/${name}: not a group`);
  }
  return CHANGE_GROUPS.flatMap((group) => {
    const folder = group.toLowerCase();
    return folders.includes(folder) ? readGroup(root, folder, group) : [];
  });
}
