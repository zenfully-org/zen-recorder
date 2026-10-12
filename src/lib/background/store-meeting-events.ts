import { isDroppableMeetingEvent } from '@/lib/page/is-droppable-meeting-event';
import type { ChunkStore } from '@/lib/storage/open-chunk-store';
import type { EventStore } from '@/lib/storage/open-event-store';
import type { BackgroundToTab, MeetingEvent, MeetingEventBatch, RecordingMeta } from '@/lib/types';

/** Rows stored per recording before only what frames the timeline, and the counts, are kept. */
const CAP_ROWS = 20_000;

/** Past the cap: the lifecycle, the readings at the start and the stop, and the counts. */
const keptPastCap = (event: MeetingEvent) =>
  !isDroppableMeetingEvent(event) || event.type === 'participant-count';

/**
 * Stores `events` within the recording's cap and counts what it leaves out, each seq once: a
 * batch the page sends again holds no seq past the highest one counted.
 */
async function storeWithinCap(
  stores: {
    store: Pick<ChunkStore, 'updateRecording'>;
    events: Pick<EventStore, 'putBatch' | 'countEvents'>;
  },
  meta: RecordingMeta | undefined,
  { recordingId, events }: MeetingEventBatch,
  { receivedAt, capRows }: { receivedAt: number; capRows: number },
): Promise<void> {
  const full = meta !== undefined && (await stores.events.countEvents(recordingId)) >= capRows;
  const kept = full ? events.filter(keptPastCap) : events;
  if (kept.length > 0) await stores.events.putBatch(recordingId, kept, receivedAt);
  const through = meta?.eventsCappedThrough ?? -1;
  const capped = events.filter((event) => !kept.includes(event) && event.seq > through);
  if (meta === undefined || capped.length === 0) return;
  await stores.store.updateRecording(recordingId, {
    eventsCapped: (meta.eventsCapped ?? 0) + capped.length,
    eventsCappedThrough: Math.max(...capped.map((event) => event.seq)),
  });
}

/**
 * Stores a batch of a recording's meeting events, each seq once, and returns its ack: the batch's
 * last seq (a batch holds at least one event, in seq order). A saved recording's events are acked
 * and dropped, as nothing can change its notes. Any other status stores them, an ended recording
 * too: the page waits for its events only so long before it ends a recording. So does a recording
 * with no metadata yet, whose start can come after its first events. Past `capRows` stored rows (a
 * meeting of hundreds), only what frames the timeline and the counts are stored, and the rest is
 * counted on the recording (`eventsCapped`), which its notes say.
 */
export async function storeMeetingEvents(
  stores: {
    store: Pick<ChunkStore, 'getRecording' | 'updateRecording'>;
    events: Pick<EventStore, 'putBatch' | 'countEvents'>;
  },
  batch: MeetingEventBatch,
  options: { now: () => number; warn: (message: string) => void; capRows?: number },
): Promise<BackgroundToTab> {
  const { recordingId, events } = batch;
  const meta = await stores.store.getRecording(recordingId);
  if (meta?.status === 'saved') {
    options.warn(
      `dropping ${events.length} meeting event(s) of ${recordingId}: its notes are saved already`,
    );
  } else {
    const capRows = options.capRows ?? CAP_ROWS;
    await storeWithinCap(stores, meta, batch, { receivedAt: options.now(), capRows });
  }
  return { type: 'eventsAck', recordingId, seq: Math.max(...events.map((event) => event.seq)) };
}
