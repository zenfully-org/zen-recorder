import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { meetingNotesSchema, parseMeetingNotes } from '@/lib/notes/parse-meeting-notes';
import { EXAMPLE_NOTES } from '@/test/notes/example-notes-document';
import { GOLDEN_NOTES } from '@/test/notes/golden-notes-document';
import { renderMeetingNotes } from './render-meeting-notes';

const fixture = (name: string) =>
  readFileSync(path.resolve(import.meta.dirname, '../../test/fixtures', name), 'utf8');

describe('renderMeetingNotes', () => {
  // A versioned interface: the expected file is written out, never a snapshot `vitest -u` rewrites.
  it("writes the format's example byte for byte", () => {
    expect(renderMeetingNotes(EXAMPLE_NOTES)).toBe(fixture('meeting-notes-example.md'));
  });

  it('writes the golden file, which holds every event type, byte for byte', () => {
    expect(renderMeetingNotes(GOLDEN_NOTES)).toBe(fixture('meeting-notes-v1.md'));
  });

  it('keeps the golden file holding every event type of the format', () => {
    const types = meetingNotesSchema.shape.events.element.options.map(
      (option) => option.shape.type.value,
    );
    expect(new Set(GOLDEN_NOTES.events.map((event) => event.type))).toEqual(new Set(types));
  });

  it.each([
    ['the example', EXAMPLE_NOTES],
    ['the golden document', GOLDEN_NOTES],
  ])('writes a file whose data block reads back as %s', (_label, document) => {
    expect(parseMeetingNotes(renderMeetingNotes(document))).toEqual(document);
  });

  it('writes the same file whatever order the document holds its keys in', () => {
    const { events, recording, ...rest } = EXAMPLE_NOTES;
    const { endReason, ...others } = recording;
    const reordered = { events, recording: { endReason, ...others }, ...rest };
    expect(renderMeetingNotes(reordered)).toBe(renderMeetingNotes(EXAMPLE_NOTES));
  });

  // The format's documentation shows the example as the renderer writes it, so the two never drift.
  it("matches the example in the format's documentation", () => {
    const doc = readFileSync(
      path.resolve(import.meta.dirname, '../../../docs/meeting-notes-format.md'),
      'utf8',
    );
    expect(doc).toContain(`\n\`\`\`\`markdown\n${renderMeetingNotes(EXAMPLE_NOTES)}\`\`\`\`\n`);
  });

  it('writes UTF-8 text with LF line endings, front matter from the first byte, no BOM', () => {
    const text = renderMeetingNotes(EXAMPLE_NOTES);
    expect(text.startsWith('---\n')).toBe(true);
    expect(text).not.toContain('\r');
    expect(text.endsWith('```\n')).toBe(true);
  });
});
