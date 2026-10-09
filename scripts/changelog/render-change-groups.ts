/**
 * Writes entries as the groups of a CHANGELOG.md section: `### <group>`, a blank line, then one
 * bullet per entry, its later lines indented by two spaces and its blank lines kept blank.
 */
import { CHANGE_GROUPS, type ChangeEntry } from './types';

function bullet(text: string): string {
  return text
    .split('\n')
    .map((line, index) => {
      if (index === 0) return `- ${line}`;
      return line === '' ? '' : `  ${line}`;
    })
    .join('\n');
}

export function renderChangeGroups(entries: readonly ChangeEntry[]): string {
  return CHANGE_GROUPS.flatMap((group) => {
    const bullets = entries
      .filter((entry) => entry.group === group)
      .map((entry) => bullet(entry.text));
    return bullets.length === 0 ? [] : [`### ${group}\n\n${bullets.join('\n')}`];
  }).join('\n\n');
}
