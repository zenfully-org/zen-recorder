import type { StoredNotesEvent } from '@/lib/notes/map-notes-events';
import type { MeetingEvent } from '@/lib/types';

/**
 * A recording's stored meeting events as the meeting notes read them. A start says what the page
 * knew when it started the recording; one a page of the first notes release sent says nothing of
 * its media, which the saved file tells (`media`).
 */
export function notesEventsFrom(
  events: readonly MeetingEvent[],
  media: 'video' | 'audio',
): StoredNotesEvent[] {
  return events.map((event) =>
    event.type === 'recording-started' ? { ...event, media: event.media ?? media } : event,
  );
}
