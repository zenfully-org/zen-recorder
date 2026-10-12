/** The lines of a notes file the store's fourth screenshot shows, and where they start in it. */
export interface NotesExcerpt {
  /** The line number of the first line shown (the title), counted from 1 as an editor does. */
  firstLine: number;
  lines: string[];
  /** The file goes on after the last line shown. */
  more: boolean;
}

/** A line saying the notes could not tell something: the picture stops before it. */
const UNOBSERVED = /\bnot (?:known|observed)\b/i;
/** The data block: the complete record for programs, not for a picture. */
const DATA_HEADING = '## Data';

/** Where the body starts: after the front matter, when the file opens with one. */
function bodyStart(lines: string[]): number {
  if (lines[0] !== '---') return 0;
  return lines.indexOf('---', 1) + 1;
}

/**
 * The notes as written, from their title on, with no line left out in between. They end before
 * the first line saying a field was not known or not observed, which would read like a fault in
 * a store picture, or else before the data block. So the picture shows more by itself as the
 * notes come to observe more: participants and events once the notes name them.
 */
export function excerptNotes(text: string): NotesExcerpt {
  const lines = text.split('\n');
  const start = bodyStart(lines);
  const title = lines.findIndex((line, index) => index >= start && line.startsWith('# '));
  if (title === -1) throw new Error('the notes have no title line ("# …")');
  const rest = lines.slice(title);
  const end = rest.findIndex((line) => UNOBSERVED.test(line) || line === DATA_HEADING);
  const shown = end === -1 ? rest : rest.slice(0, end);
  while (shown.at(-1) === '') shown.pop();
  return { firstLine: title + 1, lines: shown, more: end !== -1 };
}
