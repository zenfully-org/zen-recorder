import { z } from 'zod';
import { parseRecordingStarted } from '@/lib/protocol/parse-recording-started';
import type { RecordingEndedInfo } from '@/lib/types';

const schema = z.object({
  recordingId: z.uuid(),
  chunkCount: z.number().int().nonnegative(),
  durationMs: z.number().nonnegative(),
  reason: z.enum([
    'command',
    'left-meeting',
    'pagehide',
    'connections-lost',
    'encoder-error',
    'backlog-full',
    'video-back',
  ]),
  started: z.unknown().optional(),
});

/**
 * Validates the "recording ended" notice from the page; null when malformed. An announcement it
 * carries that cannot be read, or that names another recording, is dropped: the end still counts.
 */
export function parseRecordingEnded(input: unknown): RecordingEndedInfo | null {
  const result = schema.safeParse(input);
  if (!result.success) return null;
  const { started: raw, ...info } = result.data;
  const started = parseRecordingStarted(raw);
  return started?.recordingId === info.recordingId ? { ...info, started } : info;
}
