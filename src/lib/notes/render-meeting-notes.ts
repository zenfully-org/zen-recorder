import { type MeetingNotesDocument, meetingNotesSchema } from '@/lib/notes/parse-meeting-notes';
import { renderNotesData } from '@/lib/notes/render-notes-data';
import { renderNotesFrontMatter } from '@/lib/notes/render-notes-front-matter';
import { renderNotesHeader } from '@/lib/notes/render-notes-header';
import { renderNotesParticipants } from '@/lib/notes/render-notes-participants';
import { renderNotesTimeline } from '@/lib/notes/render-notes-timeline';

/**
 * A notes file, `zen-recorder/meeting-notes` 1.0: flat YAML front matter for note apps, a short
 * human part (summary, participants, timeline), and the complete record as a `json` block under
 * `## Data`, all from one document. The document is parsed with the format's schema first, so a
 * document that does not match the format throws, and every file lists its keys in one order.
 * UTF-8 text with LF line endings, front matter from the first byte.
 */
export function renderMeetingNotes(document: MeetingNotesDocument): string {
  const notes = meetingNotesSchema.parse(document);
  return (
    [
      renderNotesFrontMatter(notes),
      renderNotesHeader(notes),
      renderNotesParticipants(notes),
      renderNotesTimeline(notes),
      renderNotesData(notes),
    ].join('\n\n') + '\n'
  );
}
