import { cleanText } from '@/lib/notes/clean-text';

/** Every character that starts or ends inline markup in CommonMark or a common extension. */
const SPECIAL = /[\\`*_[\]<>|#~$&=%^!]/g;

/**
 * Text from a meeting page (a name, a title) as plain inline Markdown, for a table cell, a list
 * item or a heading: cleaned (`cleanText`), with a backslash before every character that could
 * start markup, and before what would make the line a list item (a leading `-` or `+`, or `1.`
 * or `2)` after leading digits).
 */
export function escapeMarkdownInline(text: string): string {
  return cleanText(text)
    .replace(SPECIAL, '\\$&')
    .replace(/^[-+]/, '\\$&')
    .replace(/^(\d+)([.)])/, '$1\\$2');
}
