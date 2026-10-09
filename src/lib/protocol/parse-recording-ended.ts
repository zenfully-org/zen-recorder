import { z } from 'zod';
import { parseRecordingStarted } from '@/lib/protocol/parse-recording-started';
import type { RecordingEndedInfo } from '@/lib/types';

/** Why a page ended a recording (`StopReason`). */
export const stopReasonSchema = z.enum([
  'command',
  'left-meeting',
  'pagehide',
  'connections-lost',
  'encoder-error',
  'backlog-full',
  'video-back',
]);

/** One of the end's event counts: read on its own, like the file length, and dropped if unreadable. */
const count = z.number().int().nonnegative().optional().catch(undefined);

const schema = z.object({
  recordingId: z.uuid(),
  chunkCount: z.number().int().nonnegative(),
  durationMs: z.number().nonnegative(),
  reason: stopReasonSchema,
  started: z.unknown().optional(),
  // Optional and read on its own: an end that is sent until it is acked must not fail on it.
  mediaDurationMs: z.number().nonnegative().optional().catch(undefined),
  eventCount: count,
  eventsDropped: count,
  eventsUnsent: count,
});

/**
 * Validates the "recording ended" notice from the page; null when malformed. An announcement it
 * carries that cannot be read, or that names another recording, is dropped, and so are a file
 * length and event counts it cannot read: the end still counts.
 */
export function parseRecordingEnded(input: unknown): RecordingEndedInfo | null {
  const result = schema.safeParse(input);
  if (!result.success) return null;
  const {
    started: raw,
    mediaDurationMs,
    eventCount,
    eventsDropped,
    eventsUnsent,
    ...rest
  } = result.data;
  // An optional field the end did not carry, or carried unreadable, is absent, never undefined.
  const info: RecordingEndedInfo = {
    ...rest,
    ...(mediaDurationMs === undefined ? {} : { mediaDurationMs }),
    ...(eventCount === undefined ? {} : { eventCount }),
    ...(eventsDropped === undefined ? {} : { eventsDropped }),
    ...(eventsUnsent === undefined ? {} : { eventsUnsent }),
  };
  const started = parseRecordingStarted(raw);
  return started?.recordingId === info.recordingId ? { ...info, started } : info;
}
