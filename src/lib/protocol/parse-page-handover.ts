import { z } from 'zod';
import { parseChunkMessage } from '@/lib/protocol/parse-chunk-message';
import { parseRecordingEnded } from '@/lib/protocol/parse-recording-ended';
import type { HeldRecording, PageHandover } from '@/lib/types';

const schema = z.object({
  recordings: z.array(
    z.object({
      recordingId: z.uuid(),
      chunks: z.array(z.unknown()),
      end: z.unknown().nullable(),
    }),
  ),
});

/** One recording, its chunks and end parsed as when they come one by one; null when any is off. */
function parseHeld(recordingId: string, chunks: unknown[], end: unknown): HeldRecording | null {
  const parsed = chunks.map(parseChunkMessage);
  const ended = end === null ? null : parseRecordingEnded(end);
  const all = parsed.flatMap((chunk) => (chunk?.recordingId === recordingId ? [chunk] : []));
  if (all.length !== chunks.length || (end !== null && ended?.recordingId !== recordingId)) {
    return null;
  }
  return { recordingId, chunks: all, end: ended };
}

/**
 * Validates what a page hands over as it goes away (`page:handover`); null when malformed. A
 * content script reads it through Xray vision, so it is the page's own object, not a copy.
 */
export function parsePageHandover(input: unknown): PageHandover | null {
  const result = schema.safeParse(input);
  if (!result.success) return null;
  const recordings = result.data.recordings.map(({ recordingId, chunks, end }) =>
    parseHeld(recordingId, chunks, end),
  );
  const valid = recordings.flatMap((recording) => (recording ? [recording] : []));
  return valid.length === recordings.length ? { recordings: valid } : null;
}
