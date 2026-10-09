import { z } from 'zod';
import { providerIdSchema } from '@/lib/protocol/parse-provider-id';
import type { RecordingStartedInfo } from '@/lib/types';

const schema = z.object({
  recordingId: z.uuid(),
  // Additive field: a page session from before multi-provider support is a Google Meet one.
  provider: providerIdSchema.default('meet'),
  meetingCode: z.string(),
  title: z.string(),
  startedAt: z.number(),
  mimeType: z.string(),
  micLabel: z.string().nullable(),
  hasVideo: z.boolean().optional(),
  eventsProtocol: z.number().int().nonnegative().optional(),
  // A page from before the notes says none: it ticked once a second too.
  tickMs: z.number().int().positive().default(1_000),
});

/** Validates the "recording started" notice from the page; null when malformed. */
export function parseRecordingStarted(input: unknown): RecordingStartedInfo | null {
  const result = schema.safeParse(input);
  if (!result.success) return null;
  const { hasVideo, eventsProtocol, ...info } = result.data;
  return {
    ...info,
    ...(hasVideo === undefined ? {} : { hasVideo }),
    ...(eventsProtocol === undefined ? {} : { eventsProtocol }),
  };
}
