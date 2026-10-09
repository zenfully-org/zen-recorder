import { z } from 'zod';
import { providerIdSchema } from '@/lib/protocol/parse-provider-id';
import type { TabSnapshot } from '@/lib/types';

const schema = z.object({
  state: z.enum(['idle', 'waiting', 'recording', 'paused', 'stopping']),
  meetingCode: z.string().nullable(),
  title: z.string(),
  recordingId: z.string().nullable(),
  recordingStartedAt: z.number().nullable(),
  remoteTracks: z.number().int().nonnegative(),
  micLabel: z.string().nullable(),
  connected: z.boolean(),
  // Added after v1. The page session can outlive an extension update (it cannot be unloaded), so
  // new fields must default rather than reject the older session's messages.
  admitted: z.boolean().default(true),
  // Sessions from before multi-provider support can only be Google Meet ones.
  provider: providerIdSchema.default('meet'),
  videoTiles: z.number().int().nonnegative().optional(),
  // Added later. Absent means none: an older page session never sends it.
  pendingRecordingIds: z.array(z.string()).optional(),
  // Added later still. Absent means the page holds less than its limit, or is older than it.
  backlogFull: z.enum(['audio-only', 'waiting']).optional(),
  // Added later still. Absent from a page session older than it: count `remoteTracks` instead.
  others: z.number().int().nonnegative().optional(),
});

/** Validates a TabSnapshot coming from the page; null when malformed. */
export function parseTabSnapshot(input: unknown): TabSnapshot | null {
  const result = schema.safeParse(input);
  if (!result.success) return null;
  const { videoTiles, pendingRecordingIds, backlogFull, others, ...snapshot } = result.data;
  return {
    ...snapshot,
    ...(videoTiles === undefined ? {} : { videoTiles }),
    ...(pendingRecordingIds === undefined ? {} : { pendingRecordingIds }),
    ...(backlogFull === undefined ? {} : { backlogFull }),
    ...(others === undefined ? {} : { others }),
  };
}
