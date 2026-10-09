import { z } from 'zod';
import { providerIdSchema } from '@/lib/protocol/parse-provider-id';
import { stopReasonSchema } from '@/lib/protocol/parse-recording-ended';

const count = z.number().int().nonnegative();

/**
 * A recording's stored metadata as the meeting notes read it. A recording stored by an older
 * version lacks what came later, and gets what that version did: Meet before there were other
 * services, no meeting events (the page session sent none), the page's tick of 1 s, nothing moved
 * by the remux. A missing time zone stays missing: the notes then take the background's zone.
 */
const schema = z.object({
  id: z.string().min(1),
  provider: providerIdSchema.default('meet'),
  meetingCode: z.string(),
  title: z.string(),
  startedAt: z.number(),
  endedAt: z.number().optional(),
  durationMs: z.number().nonnegative().optional(),
  mimeType: z.string(),
  status: z.enum(['recording', 'ended', 'finalizing', 'saved', 'interrupted', 'failed']),
  chunkCount: count,
  byteSize: count,
  filename: z.string().optional(),
  recovered: z.boolean().default(false),
  hasVideo: z.boolean().default(false),
  lastChunkAt: z.number().optional(),
  endReason: stopReasonSchema.optional(),
  endCause: z.enum(['ended', 'port-lost', 'recovered-at-startup']).optional(),
  eventsProtocol: count.default(0),
  eventCount: count.optional(),
  eventsDropped: count.optional(),
  eventsUnsent: count.optional(),
  timeZone: z.string().min(1).optional(),
  tickMs: z.number().int().positive().default(1_000),
  notesState: z.enum(['pending', 'saved', 'skipped', 'failed']).optional(),
  notesAttempts: count.default(0),
  notesFilename: z.string().optional(),
  notesError: z.string().optional(),
  startOffsetMs: count.default(0),
  remuxed: z.boolean().default(true),
  rawFilename: z.string().optional(),
});

/** A recording's metadata as `parseRecordingMeta` reads it. */
export type StoredRecordingMeta = z.output<typeof schema>;

/** Validates a recording's stored metadata for the meeting notes; null when it cannot be read. */
export function parseRecordingMeta(input: unknown): StoredRecordingMeta | null {
  const result = schema.safeParse(input);
  return result.success ? result.data : null;
}
