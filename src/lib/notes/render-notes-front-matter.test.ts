import { describe, expect, it } from 'vitest';
import { EXAMPLE_NOTES } from '@/test/notes/example-notes-document';
import { GOLDEN_NOTES } from '@/test/notes/golden-notes-document';
import { renderNotesFrontMatter } from './render-notes-front-matter';

const lines = (document: Parameters<typeof renderNotesFrontMatter>[0]) =>
  renderNotesFrontMatter(document).split('\n');

describe('renderNotesFrontMatter', () => {
  it('leaves a name the page did not show out of the list, and counts everyone', () => {
    const front = lines(GOLDEN_NOTES);
    expect(front).not.toContain('  - null');
    expect(front).toContain('participants_count: 4');
  });

  it('lists no name without names, only how many people there were', () => {
    const anonymous = { ...EXAMPLE_NOTES, capture: { ...EXAMPLE_NOTES.capture, names: false } };
    const front = lines(anonymous);
    expect(front).toContain('names: false');
    expect(front.some((line) => line.startsWith('participants:'))).toBe(false);
    expect(front).toContain('participants_count: 4');
  });

  it('writes an empty list when names were collected but none was shown', () => {
    expect(lines({ ...EXAMPLE_NOTES, participants: [] })).toContain('participants: []');
  });

  it('caps the list at 50 names', () => {
    const many = Array.from({ length: 60 }, (_, index) => ({
      ...EXAMPLE_NOTES.participants[1],
      id: `p${index + 1}`,
      name: `Person ${index + 1}`,
      names: [`Person ${index + 1}`],
      self: false,
      identity: 'display-name' as const,
      presentAtStart: true,
      presentAtEnd: true,
      spans: [],
    }));
    const front = lines({ ...EXAMPLE_NOTES, participants: many });
    expect(front.filter((line) => line.startsWith('  - '))).toHaveLength(50);
    expect(front).toContain('participants_count: 60');
  });

  it('writes null for what is not known', () => {
    const unknown = {
      ...EXAMPLE_NOTES,
      meeting: { ...EXAMPLE_NOTES.meeting, url: null },
      recording: { ...EXAMPLE_NOTES.recording, end: null, durationMs: null },
      capture: { ...EXAMPLE_NOTES.capture, participantSource: 'none' as const },
    };
    const front = lines(unknown);
    expect(front).toEqual(
      expect.arrayContaining([
        'url: null',
        'end: null',
        'duration: null',
        'participants_count: null',
      ]),
    );
  });
});
