import type { MeetingNotesDocument } from '@/lib/notes/parse-meeting-notes';

/** A JSON value on one line, with a space after every `:` and `,`, as people write JSON. */
const inline = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(inline).join(', ')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value).map(
      ([key, item]) => `${JSON.stringify(key)}: ${inline(item)}`,
    );
    return `{${entries.join(', ')}}`;
  }
  return JSON.stringify(value);
};

/** A list with one item per line, at `indent`, closed at `indent`. */
const lines = (items: readonly unknown[], indent: string): string => {
  if (items.length === 0) return '[]';
  const itemLines = items.map((item) => `${indent}  ${inline(item)}`);
  return `[\n${itemLines.join(',\n')}\n${indent}]`;
};

/**
 * The `## Data` section: the document as a fenced `json` block, one key per line at the top, each
 * object on one line, and one event, participant or coverage span per line. No string in it can
 * hold a line break (JSON escapes it), so nothing inside can close the fence.
 */
export function renderNotesData(document: MeetingNotesDocument): string {
  const { coverage, ...capture } = document.capture;
  const fields: [string, string][] = [
    ['schema', inline(document.schema)],
    ['schemaVersion', inline(document.schemaVersion)],
    ['schemaUrl', inline(document.schemaUrl)],
    ['generator', inline(document.generator)],
    ['meeting', inline(document.meeting)],
    ['recording', inline(document.recording)],
    ['capture', `${inline(capture).slice(0, -1)}, "coverage": ${lines(coverage, '  ')}}`],
    ['participants', lines(document.participants, '  ')],
    ['events', lines(document.events, '  ')],
  ];
  const body = fields.map(([key, value]) => `  ${JSON.stringify(key)}: ${value}`).join(',\n');
  return ['## Data', '', '```json', '{', body, '}', '```'].join('\n');
}
