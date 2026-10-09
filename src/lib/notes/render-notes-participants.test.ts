import { describe, expect, it } from 'vitest';
import { EXAMPLE_NOTES } from '@/test/notes/example-notes-document';
import { renderNotesParticipants } from './render-notes-participants';

const withParticipants = (participants: (typeof EXAMPLE_NOTES)['participants']) =>
  renderNotesParticipants({ ...EXAMPLE_NOTES, participants });

describe('renderNotesParticipants', () => {
  it('says when nobody was observed', () => {
    expect(withParticipants([])).toBe('## Participants (0)\n\nNo participants were observed.');
  });

  it('says where someone is in the file, or that it is not known', () => {
    const [jo, , ben] = EXAMPLE_NOTES.participants;
    if (!jo || !ben) throw new Error('the example has its participants');
    const text = withParticipants([
      { ...jo, spans: [] },
      { ...ben, spans: [{ joinedMs: 1_000, leftMs: 2_000 }] },
    ]);
    expect(text).toContain('| p1 | Jo Rocha (you) | not known |');
    expect(text).toContain('| p3 | Ben Carter | 0:00:01 to 0:00:02 |');
  });

  it('escapes an id, which a newer page could write otherwise', () => {
    const [jo] = EXAMPLE_NOTES.participants;
    if (!jo) throw new Error('the example has its participants');
    expect(withParticipants([{ ...jo, id: 'p|1' }])).toContain('| p\\|1 |');
  });
});
