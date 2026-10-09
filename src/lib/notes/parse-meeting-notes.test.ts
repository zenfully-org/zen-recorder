import { describe, expect, it } from 'vitest';
import { EXAMPLE_NOTES } from '@/test/notes/example-notes-document';
import { parseMeetingNotes } from './parse-meeting-notes';

const file = (json: string, before = '# Notes\n\n') =>
  `${before}## Data\n\n\`\`\`json\n${json}\n\`\`\`\n`;
const valid = JSON.stringify(EXAMPLE_NOTES);

describe('parseMeetingNotes', () => {
  it('reads the data block of a notes file', () => {
    expect(parseMeetingNotes(file(valid))).toEqual(EXAMPLE_NOTES);
  });

  it('reads the first json block after the Data heading, not one before it', () => {
    const before = '# Notes\n\n```json\n{"not": "the data"}\n```\n\n';
    expect(parseMeetingNotes(file(valid, before))).toEqual(EXAMPLE_NOTES);
  });

  it.each([
    ['no Data heading', `# Notes\n\n\`\`\`json\n${valid}\n\`\`\`\n`],
    ['no json block after the heading', '# Notes\n\n## Data\n\nnothing here\n'],
    ['JSON that does not parse', file('{"schema": ')],
    ['a document of another format', file(JSON.stringify({ ...EXAMPLE_NOTES, schema: 'other' }))],
    [
      'a major version it does not know',
      file(JSON.stringify({ ...EXAMPLE_NOTES, schemaVersion: '2.0' })),
    ],
    ['not an object', file('[1, 2]')],
  ])('reads nothing from %s', (_label, text) => {
    expect(parseMeetingNotes(text)).toBeNull();
  });

  // Readers of 1.x ignore what a newer minor version adds.
  it('reads a newer minor version, leaving out the fields and event types it does not know', () => {
    const newer = {
      ...EXAMPLE_NOTES,
      schemaVersion: '1.3',
      meeting: { ...EXAMPLE_NOTES.meeting, platform: 'web' },
      events: [
        ...EXAMPLE_NOTES.events,
        {
          seq: 20,
          type: 'hand-raised',
          at: '2026-10-04T14:58:00+02:00',
          mediaMs: 3_120_000,
          source: 'page',
        },
      ],
    };
    expect(parseMeetingNotes(file(JSON.stringify(newer)))).toEqual({
      ...EXAMPLE_NOTES,
      schemaVersion: '1.3',
    });
  });

  it('refuses an event of a known type that does not hold its fields', () => {
    const broken = {
      ...EXAMPLE_NOTES,
      events: [{ seq: 0, type: 'mic', at: 'later' }, 'not an event'],
    };
    expect(parseMeetingNotes(file(JSON.stringify(broken)))).toBeNull();
  });
});
