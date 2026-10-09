import { z } from 'zod';
import { parseLifecycleCommand } from '@/lib/protocol/parse-lifecycle-command';
import { parseSettings } from '@/lib/settings/parse-settings';
import type { BackgroundToTab, LifecycleCommand } from '@/lib/types';

const seq = z.number().int().nonnegative();
/** Every message the background sends a tab, one shape per `type`. */
const schema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('ack'), recordingId: z.string(), seq }),
  z.object({ type: z.literal('eventsAck'), recordingId: z.string(), seq }),
  z.object({ type: z.literal('endAck'), recordingId: z.string() }),
  z.object({
    type: z.literal('command'),
    command: z.custom<LifecycleCommand>((value) => parseLifecycleCommand(value) !== null),
  }),
  // Settings are never refused: what is missing or malformed takes its default.
  z.object({ type: z.literal('settings'), settings: z.unknown().transform(parseSettings) }),
  z.object({
    type: z.literal('saved'),
    recordingId: z.string(),
    filename: z.string(),
    chunkCount: z.number().int().nonnegative(),
    byteSize: z.number().nonnegative(),
  }),
  z.object({ type: z.literal('error'), recordingId: z.string().nullable(), message: z.string() }),
  z.object({ type: z.literal('logAck'), seq }),
]);

/** Validates a Port message from the background to a meeting tab; null when malformed. */
export function parseBackgroundToTab(input: unknown): BackgroundToTab | null {
  const result = schema.safeParse(input);
  return result.success ? result.data : null;
}
