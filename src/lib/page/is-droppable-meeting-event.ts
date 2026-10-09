import type { MeetingEvent } from '@/lib/types';

/** The lifecycle events are the timeline's frame. */
const LIFECYCLE = new Set<MeetingEvent['type']>(['recording-started', 'recording-stopped']);

/** Whether a full events queue may drop `event`: every one but a recording's start and stop. */
export function isDroppableMeetingEvent(event: MeetingEvent): boolean {
  return !LIFECYCLE.has(event.type);
}
