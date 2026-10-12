import type { MeetingEvent } from '@/lib/types';

/**
 * The lifecycle events: they frame the timeline, say what the file leaves out (a pause) and why a
 * file ends where it does (its video failed, the recorder stopped restarting it).
 */
const LIFECYCLE = new Set<MeetingEvent['type']>([
  'recording-started',
  'recording-stopped',
  'recording-paused',
  'recording-resumed',
  'video-failed',
  'restarts-exhausted',
]);

/**
 * Whether a full events queue may drop `event`: every one but the lifecycle events and the readings
 * of the call at the start and at the stop, from which the notes tell who was there.
 */
export function isDroppableMeetingEvent(event: MeetingEvent): boolean {
  if (event.type === 'roster') return event.why === 'reannounce';
  return !LIFECYCLE.has(event.type);
}
