import type { StoredNotesEvent } from '@/lib/notes/map-notes-events';
import type { MeetingEvent } from '@/lib/types';

/**
 * A recording's stored meeting events as the meeting notes read them. The page reports a
 * recording's start and stop, and nothing yet about why it started or what it saw then: those
 * fields are unknown (null), and the notes say so.
 */
export function notesEventsFrom(
  events: readonly MeetingEvent[],
  media: 'video' | 'audio',
): StoredNotesEvent[] {
  return events.map((event) =>
    event.type === 'recording-started'
      ? {
          ...event,
          cause: null,
          media,
          audioOnlyReason: null,
          continuesRecordingId: null,
          gapMs: null,
          mic: null,
          tabVisible: null,
          ownShare: null,
        }
      : event,
  );
}
