import { describe, expect, it } from 'vitest';
import { EXAMPLE_NOTES } from '@/test/notes/example-notes-document';
import { GOLDEN_NOTES } from '@/test/notes/golden-notes-document';
import { describeNotesParticipant } from './describe-notes-participant';

describe('describeNotesParticipant', () => {
  it('names a participant, escaped', () => {
    expect(describeNotesParticipant(EXAMPLE_NOTES, 'p4')).toBe('Chloé Martin \\| Design');
  });

  it('says which participant is you', () => {
    expect(describeNotesParticipant(EXAMPLE_NOTES, 'p1')).toBe('Jo Rocha (you)');
  });

  it('says when the page showed no name', () => {
    expect(describeNotesParticipant(GOLDEN_NOTES, 'p4')).toBe('(name not shown)');
  });

  it('says names were not collected, the user still being you', () => {
    const anonymous = {
      ...EXAMPLE_NOTES,
      capture: { ...EXAMPLE_NOTES.capture, names: false },
      participants: EXAMPLE_NOTES.participants.map((participant) => ({
        ...participant,
        name: null,
        names: [],
      })),
    };
    expect(describeNotesParticipant(anonymous, 'p1')).toBe('(name not collected) (you)');
  });

  it('calls an id no participant has someone', () => {
    expect(describeNotesParticipant(EXAMPLE_NOTES, 'p9')).toBe('someone');
  });
});
