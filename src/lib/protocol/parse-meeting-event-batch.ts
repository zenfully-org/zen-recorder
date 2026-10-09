import { z } from 'zod';
import { stopReasonSchema } from '@/lib/protocol/parse-recording-ended';
import type { MeetingEvent, MeetingEventBatch } from '@/lib/types';

const MAX_EVENTS = 200;

const seqSchema = z.number().int().nonnegative();

/** Each event is read on its own: one this build cannot read is dropped, not the batch. */
const eventSchema = z
  .object({
    seq: seqSchema,
    atMs: z.number().nonnegative(),
    mediaMs: z.number().nonnegative(),
    paused: z.literal(true).optional(),
  })
  .and(
    z.discriminatedUnion('type', [
      z.object({ type: z.literal('recording-started') }),
      z.object({ type: z.literal('recording-stopped'), reason: stopReasonSchema }),
    ]),
  );

const envelopeSchema = z.object({
  recordingId: z.uuid(),
  events: z
    .array(z.looseObject({ seq: seqSchema }))
    .min(1)
    .max(MAX_EVENTS),
  droppedRanges: z.array(z.tuple([seqSchema, seqSchema])),
});

/**
 * Validates a batch of meeting events from the page; null when its envelope is malformed: no
 * events, more than 200, seqs not strictly ascending (a gap is a dropped event and fine), or a
 * dropped range that is backwards or covers a seq of the batch. Events it cannot read, of a type
 * this build does not know too, are dropped and counted in `rejected`.
 */
export function parseMeetingEventBatch(
  input: unknown,
): { batch: MeetingEventBatch; rejected: number } | null {
  const envelope = envelopeSchema.safeParse(input);
  if (!envelope.success) return null;
  const { recordingId, events, droppedRanges } = envelope.data;
  const seqs = events.map((event) => event.seq);
  let previous = -1;
  for (const seq of seqs) {
    if (seq <= previous) return null;
    previous = seq;
  }
  const rangeIsBad = ([from, to]: [number, number]): boolean =>
    from > to || seqs.some((seq) => seq >= from && seq <= to);
  if (droppedRanges.some(rangeIsBad)) return null;
  const read: MeetingEvent[] = events.flatMap((event) => {
    const parsed = eventSchema.safeParse(event);
    if (!parsed.success) return [];
    const { paused, ...rest } = parsed.data;
    return [paused ? { ...rest, paused } : rest];
  });
  return {
    batch: { recordingId, events: read, droppedRanges },
    rejected: events.length - read.length,
  };
}
