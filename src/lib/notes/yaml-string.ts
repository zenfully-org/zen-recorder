import { cleanText } from '@/lib/notes/clean-text';

/**
 * A YAML scalar for the front matter: always double-quoted, through `JSON.stringify`, whose
 * escapes YAML's double-quoted style reads the same. Unquoted, YAML would read `no`, `null`,
 * `2026-10-04` or `0123` as a boolean, null, a date or a number, and `Ben: Carter` as a mapping.
 */
export function yamlString(text: string): string {
  return JSON.stringify(cleanText(text));
}
