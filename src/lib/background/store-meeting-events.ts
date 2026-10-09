import type { ChunkStore } from '@/lib/storage/open-chunk-store';
import type { EventStore } from '@/lib/storage/open-event-store';
import type { BackgroundToTab, MeetingEventBatch } from '@/lib/types';

/**
 * Stores a batch of a recording's meeting events, each seq once, and returns its ack: the batch's
 * last seq (a batch holds at least one event, in seq order). A saved recording's events are acked
 * and dropped, as nothing can change its notes. Any other status stores them, an ended recording
 * too: the page waits for its events only so long before it ends a recording. So does a recording
 * with no metadata yet, whose start can come after its first events.
 */
export async function storeMeetingEvents(
  stores: { store: Pick<ChunkStore, 'getRecording'>; events: Pick<EventStore, 'putBatch'> },
  batch: MeetingEventBatch,
  { now, warn }: { now: () => number; warn: (message: string) => void },
): Promise<BackgroundToTab> {
  const { recordingId, events } = batch;
  const meta = await stores.store.getRecording(recordingId);
  if (meta?.status === 'saved') {
    warn(
      `dropping ${events.length} meeting event(s) of ${recordingId}: its notes are saved already`,
    );
  } else {
    await stores.events.putBatch(recordingId, events, now());
  }
  return { type: 'eventsAck', recordingId, seq: Math.max(...events.map((event) => event.seq)) };
}
