import { escapeMarkdownInline } from '@/lib/notes/escape-markdown-inline';
import type { MeetingNotesDocument } from '@/lib/notes/parse-meeting-notes';

/**
 * A participant as the human part of the notes names them: their last name shown (escaped), and
 * "(you)" for the user. A file without names says so instead of a name.
 */
export function describeNotesParticipant(document: MeetingNotesDocument, id: string): string {
  const participant = document.participants.find((candidate) => candidate.id === id);
  if (!participant) return 'someone';
  const fallback = document.capture.names ? '(name not shown)' : '(name not collected)';
  const name = participant.name === null ? fallback : escapeMarkdownInline(participant.name);
  return participant.self === true ? `${name} (you)` : name;
}
