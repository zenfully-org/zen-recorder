import { formatMediaOffset } from '@/lib/notes/format-media-offset';
import type { MeetingNotesDocument } from '@/lib/notes/parse-meeting-notes';
import { yamlString } from '@/lib/notes/yaml-string';

/** The front matter lists at most this many names, so a large meeting keeps the file readable. */
const MAX_NAMES = 50;

const optional = (text: string | null): string => (text === null ? 'null' : yamlString(text));

/**
 * The flat YAML front matter, for note apps that index it: snake-case keys, every string
 * double-quoted, the date unquoted so they read it as a date. Derived from the data block, which
 * stays the complete record. Without names, no `participants` list, only the count.
 */
export function renderNotesFrontMatter(document: MeetingNotesDocument): string {
  const { meeting, recording, capture, participants } = document;
  const names = participants.flatMap((participant) => participant.name ?? []).slice(0, MAX_NAMES);
  const nameList =
    names.length === 0
      ? ['participants: []']
      : ['participants:', ...names.map((name) => `  - ${yamlString(name)}`)];
  const duration = recording.durationMs === null ? null : formatMediaOffset(recording.durationMs);
  return [
    '---',
    `schema: ${yamlString(document.schema)}`,
    `schema_version: ${yamlString(document.schemaVersion)}`,
    `title: ${yamlString(meeting.title)}`,
    `service: ${yamlString(meeting.serviceName)}`,
    `meeting_id: ${yamlString(meeting.id)}`,
    `url: ${optional(meeting.url)}`,
    `date: ${recording.start.slice(0, 10)}`,
    `start: ${yamlString(recording.start)}`,
    `end: ${optional(recording.end)}`,
    `timezone: ${yamlString(recording.timeZone)}`,
    `recording: ${yamlString(recording.file)}`,
    `duration: ${optional(duration)}`,
    `paused: ${yamlString(formatMediaOffset(recording.pausedMs))}`,
    `media: ${yamlString(recording.media)}`,
    `recovered: ${recording.recovered}`,
    `names: ${capture.names}`,
    ...(capture.names ? nameList : []),
    `participants_count: ${capture.participantSource === 'none' ? 'null' : participants.length}`,
    '---',
  ].join('\n');
}
