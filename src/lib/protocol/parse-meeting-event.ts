import { z } from 'zod';
import { stopReasonSchema } from '@/lib/protocol/parse-recording-ended';
import { audioOnlyReasonSchema, startCauseSchema } from '@/lib/protocol/parse-recording-started';
import type { MeetingEvent } from '@/lib/types';

/** A fact of the start this build cannot read, or one an older page never sent, is not known. */
const unknownUnless = <Schema extends z.ZodType>(schema: Schema) => schema.nullable().catch(null);

const micSchema = z.enum(['live', 'muted', 'not-connected']);
const coverage = {
  signal: z.enum(['participants', 'share', 'all']),
  reason: z.enum(['tab-hidden', 'presence-unavailable']),
};

const startedSchema = z.object({
  type: z.literal('recording-started'),
  cause: unknownUnless(startCauseSchema),
  media: unknownUnless(z.enum(['video', 'audio'])),
  audioOnlyReason: unknownUnless(audioOnlyReasonSchema),
  continuesRecordingId: unknownUnless(z.string().min(1)),
  gapMs: unknownUnless(z.number().int().nonnegative()),
  mic: unknownUnless(micSchema),
  tabVisible: unknownUnless(z.boolean()),
  ownShare: unknownUnless(z.boolean()),
});

const eventSchema = z
  .object({
    seq: z.number().int().nonnegative(),
    atMs: z.number().nonnegative(),
    mediaMs: z.number().nonnegative(),
    paused: z.literal(true).optional(),
  })
  .and(
    z.discriminatedUnion('type', [
      startedSchema,
      z.object({ type: z.literal('recording-stopped'), reason: stopReasonSchema }),
      z.object({ type: z.literal('recording-paused') }),
      z.object({ type: z.literal('recording-resumed'), pausedMs: z.number().int().nonnegative() }),
      z.object({ type: z.literal('connection-lost') }),
      z.object({ type: z.literal('connection-restored'), lostMs: z.number().int().nonnegative() }),
      z.object({ type: z.literal('extension-reloaded') }),
      z.object({ type: z.literal('mic'), state: micSchema }),
      z.object({ type: z.literal('title-changed'), title: z.string() }),
      z.object({ type: z.literal('coverage-lost'), ...coverage }),
      z.object({ type: z.literal('coverage-restored'), ...coverage }),
      z.object({ type: z.literal('video-failed') }),
      z.object({ type: z.literal('restarts-exhausted'), failures: z.number().int().positive() }),
    ]),
  );

/**
 * Validates one meeting event, from a page's batch or from the event store; null when it cannot be
 * read, a type this build does not know included. A fact of a start it cannot read is not known
 * (null), and so is one a page of an older version never sent: the start, which frames the
 * timeline, is kept.
 */
export function parseMeetingEvent(input: unknown): MeetingEvent | null {
  const parsed = eventSchema.safeParse(input);
  if (!parsed.success) return null;
  const { paused, ...event } = parsed.data;
  return paused ? { ...event, paused } : event;
}
