import type { RecordingEndedInfo, RecordingMeta } from '@/lib/types';

/**
 * What a recording's end stores in its metadata: when and why it ended, how long it is, and the
 * counts of its meeting events when the end carries them (an older page session sends none).
 */
export function recordingEndPatch(
  info: RecordingEndedInfo,
  endedAt: number,
): Partial<RecordingMeta> {
  const { eventCount, eventsDropped, eventsUnsent } = info;
  return {
    status: 'ended',
    endedAt,
    durationMs: info.durationMs,
    endReason: info.reason,
    endCause: 'ended',
    ...(eventCount === undefined ? {} : { eventCount }),
    ...(eventsDropped === undefined ? {} : { eventsDropped }),
    ...(eventsUnsent === undefined ? {} : { eventsUnsent }),
  };
}
