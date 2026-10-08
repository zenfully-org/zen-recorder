import { z } from 'zod';
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
  ]),
});

/** Validates the "recording ended" notice from the page; null when malformed. */
export function parseRecordingEnded(input: unknown): RecordingEndedInfo | null {
  const result = schema.safeParse(input);
  return result.success ? result.data : null;
}
