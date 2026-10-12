import type { MeetingEvent } from '@/lib/types';

/**
 * The lifecycle events: they frame the timeline and say why a file ends where it does (its video
 * failed, the recorder stopped restarting it).
 */
const LIFECYCLE = new Set<MeetingEvent['type']>([
  'recording-started',
  'recording-stopped',
  'video-failed',
  'restarts-exhausted',
]);

/** Whether a full events queue may drop `event`: every one but the lifecycle events. */
export function isDroppableMeetingEvent(event: MeetingEvent): boolean {
  return !LIFECYCLE.has(event.type);
}
