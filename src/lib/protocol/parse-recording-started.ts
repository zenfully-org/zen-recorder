import { z } from 'zod';
import { providerIdSchema } from '@/lib/protocol/parse-provider-id';
import type { RecordingStartedInfo } from '@/lib/types';

/** Why a recording started (`StartCause`). */
export const startCauseSchema = z.enum([
  'auto-first-remote',
  'auto-on-join',
  'manual',
  'restart-after-video-failure',
  'restart-after-encoder-error',
  'restart-after-backlog-full',
  'restart-after-video-back',
]);

/** Why a recording has no video (`AudioOnlyReason`). */
export const audioOnlyReasonSchema = z.enum([
  'setting-off',
  'no-encoder',
  'pipeline-failed',
  'video-failed',
  'backlog-full',
]);

/** A fact for the notes is read on its own: one it cannot read is dropped, never the start. */
const fact = <Schema extends z.ZodType>(schema: Schema) => schema.optional().catch(undefined);

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
  startCause: fact(startCauseSchema),
  audioOnlyReason: fact(audioOnlyReasonSchema),
  continuesRecordingId: fact(z.string().min(1)),
  gapMs: fact(z.number().int().nonnegative()),
});

/** Validates the "recording started" notice from the page; null when malformed. */
export function parseRecordingStarted(input: unknown): RecordingStartedInfo | null {
  const result = schema.safeParse(input);
  if (!result.success) return null;
  const { hasVideo, eventsProtocol, startCause, audioOnlyReason, ...info } = result.data;
  const { continuesRecordingId, gapMs, ...rest } = info;
  // An optional field the start did not carry, or carried unreadable, is absent, never undefined.
  return {
    ...rest,
    ...(hasVideo === undefined ? {} : { hasVideo }),
    ...(eventsProtocol === undefined ? {} : { eventsProtocol }),
    ...(startCause === undefined ? {} : { startCause }),
    ...(audioOnlyReason === undefined ? {} : { audioOnlyReason }),
    ...(continuesRecordingId === undefined ? {} : { continuesRecordingId }),
    ...(gapMs === undefined ? {} : { gapMs }),
  };
}
