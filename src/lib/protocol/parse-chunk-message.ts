import { z } from 'zod';
import type { ChunkMessage } from '@/lib/types';

const schema = z.object({
  recordingId: z.uuid(),
  seq: z.number().int().nonnegative(),
  blob: z.instanceof(Blob),
  timestampMs: z.number(),
});

/** Validates an audio chunk coming from the page; null when malformed. */
export function parseChunkMessage(input: unknown): ChunkMessage | null {
  const result = schema.safeParse(input);
  return result.success ? result.data : null;
}
