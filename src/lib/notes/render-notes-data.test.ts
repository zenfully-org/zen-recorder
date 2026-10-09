import { describe, expect, it } from 'vitest';
import { EXAMPLE_NOTES } from '@/test/notes/example-notes-document';
import { renderNotesData } from './render-notes-data';

describe('renderNotesData', () => {
  it('writes each top key on a line, objects inline, and one event per line', () => {
    const lines = renderNotesData(EXAMPLE_NOTES).split('\n');
    expect(lines.slice(0, 5)).toEqual([
      '## Data',
      '',
      '```json',
      '{',
      '  "schema": "zen-recorder/meeting-notes",',
    ]);
    expect(lines).toContain('  "generator": {"name": "zen-recorder", "version": "0.4.0"},');
    expect(lines.filter((line) => line.startsWith('    {"seq": '))).toHaveLength(
      EXAMPLE_NOTES.events.length,
    );
    expect(lines.slice(-2)).toEqual(['}', '```']);
  });

  it('writes an empty list on its key line', () => {
    const empty = {
      ...EXAMPLE_NOTES,
      capture: { ...EXAMPLE_NOTES.capture, coverage: [] },
      participants: [],
      events: [],
    };
    const text = renderNotesData(empty);
    expect(text).toContain('"coverage": []},\n  "participants": [],\n  "events": []\n}');
  });

  it('keeps a line break in a value on its line, escaped', () => {
    const title = { ...EXAMPLE_NOTES, meeting: { ...EXAMPLE_NOTES.meeting, title: 'a\n```\nb' } };
    expect(renderNotesData(title)).toContain('"title": "a\\n```\\nb"');
  });
});
