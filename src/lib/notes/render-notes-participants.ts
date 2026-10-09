import { describeNotesParticipant } from '@/lib/notes/describe-notes-participant';
import { escapeMarkdownInline } from '@/lib/notes/escape-markdown-inline';
import { formatMediaOffset } from '@/lib/notes/format-media-offset';
import type { MeetingNotesDocument, NotesParticipant } from '@/lib/notes/parse-meeting-notes';

/** Where a participant is in the file: "whole recording", or each span from its start to its end. */
const describePresence = ({ spans }: NotesParticipant): string => {
  if (spans.length === 0) return 'not known';
  if (spans.length === 1 && spans[0]?.joinedMs === null && spans[0].leftMs === null) {
    return 'whole recording';
  }
  return spans
    .map(({ joinedMs, leftMs }) => {
      const from = formatMediaOffset(joinedMs ?? 0);
      return `${from} to ${leftMs === null ? 'end' : formatMediaOffset(leftMs)}`;
    })
    .join(', ');
};

/** The `## Participants` section: one row per person, with where they are in the file. */
export function renderNotesParticipants(document: MeetingNotesDocument): string {
  const { participants } = document;
  const heading = `## Participants (${participants.length})`;
  if (participants.length === 0) return [heading, '', 'No participants were observed.'].join('\n');
  return [
    heading,
    '',
    '| Id | Name | In this file |',
    '|---|---|---|',
    ...participants.map(
      (participant) =>
        `| ${escapeMarkdownInline(participant.id)} | ${describeNotesParticipant(document, participant.id)} | ${describePresence(participant)} |`,
    ),
  ].join('\n');
}
