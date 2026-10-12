// @vitest-environment node
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { excerptNotes } from './excerpt-notes';

/** A notes file as every release up to now writes it: the summary says what it did not observe. */
const PARTLY_OBSERVED = [
  '---',
  'schema: "zen-recorder/meeting-notes"',
  'title: "Weekly product sync"',
  '---',
  '',
  '# Weekly product sync',
  '',
  'Google Meet · Monday 2026-10-12 · 09:28 to 09:29 (UTC, UTC+00:00)',
  '',
  '- **Link:** https://meet.google.com/abc-defg-hij',
  '- **Recorded:** 09:28:45 to 09:29:41',
  '- **Started:** not known',
  '- **Ended:** you stopped the recording',
  '- **Your microphone:** not observed',
  '',
  '## Participants (0)',
].join('\n');

describe('excerptNotes', () => {
  it('starts at the title and ends before the first field the notes did not observe', () => {
    expect(excerptNotes(PARTLY_OBSERVED)).toEqual({
      firstLine: 6,
      lines: [
        '# Weekly product sync',
        '',
        'Google Meet · Monday 2026-10-12 · 09:28 to 09:29 (UTC, UTC+00:00)',
        '',
        '- **Link:** https://meet.google.com/abc-defg-hij',
        '- **Recorded:** 09:28:45 to 09:29:41',
      ],
      more: true,
    });
  });

  it.each([
    ['a summary line', '- **Started:** not known'],
    ['a table cell', '| p2 | Ana Souza | not known |'],
    ['a sentence', 'Participants: Not observed by this page.'],
  ])('ends before "not known" or "not observed" in %s', (_where, line) => {
    const text = ['# Title', '', 'Said.', line, 'After.'].join('\n');

    expect(excerptNotes(text)).toEqual({
      firstLine: 1,
      lines: ['# Title', '', 'Said.'],
      more: true,
    });
  });

  it('shows the participants and the timeline of notes that name everything, up to the data block', () => {
    const file = path.resolve(
      import.meta.dirname,
      '../../src/test/fixtures/meeting-notes-example.md',
    );
    const text = readFileSync(file, 'utf8');
    const lines = text.split('\n');

    const excerpt = excerptNotes(text);

    expect(excerpt.firstLine).toBe(lines.indexOf('# Weekly product sync') + 1);
    expect(excerpt.lines).toContain('## Participants (4)');
    expect(excerpt.lines).toContain('## Timeline');
    expect(excerpt.lines.at(-1)).toBe('| 14:57:47 | 0:52:00 | Recording stopped |');
    expect(excerpt.lines).not.toContain('## Data');
    expect(excerpt.more).toBe(true);
  });

  it('never takes a line of the front matter for the title', () => {
    const text = ['---', '# not the title: a YAML comment', '---', '', '# Title', 'Body.'].join(
      '\n',
    );

    expect(excerptNotes(text)).toEqual({ firstLine: 5, lines: ['# Title', 'Body.'], more: false });
  });

  it('says the file goes on only when lines follow the ones shown', () => {
    expect(excerptNotes('# Title\nBody.\n\n').more).toBe(false);
    expect(excerptNotes('# Title\nBody.\n\n## Data\n').more).toBe(true);
  });

  it('refuses notes without a title', () => {
    expect(() => excerptNotes('---\ntitle: "x"\n---\n\nNo heading.')).toThrow(
      'the notes have no title line ("# …")',
    );
  });
});
