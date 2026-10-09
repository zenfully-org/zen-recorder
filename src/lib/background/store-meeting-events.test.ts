import { afterEach, describe, expect, it } from 'vitest';
import { type ChunkStore, openChunkStore } from '@/lib/storage/open-chunk-store';
import { type EventStore, openEventStore } from '@/lib/storage/open-event-store';
import type { MeetingEvent, RecordingMeta } from '@/lib/types';
import { storeMeetingEvents } from './store-meeting-events';

const RECORDING_ID = '4f3c6d2a-9d7c-4a4e-9f1e-0c1b2a3d4e5f';
const STARTED: MeetingEvent = { seq: 0, atMs: 1, mediaMs: 0, type: 'recording-started' };
const STOPPED: MeetingEvent = {
  seq: 1,
  atMs: 2,
  mediaMs: 9,
  type: 'recording-stopped',
  reason: 'command',
};

const recording = (status: RecordingMeta['status']): RecordingMeta => ({
  id: RECORDING_ID,
  provider: 'meet',
  meetingCode: 'abc-defg-hij',
  title: 'Standup',
  startedAt: 5,
  mimeType: 'audio/webm',
  status,
  chunkCount: 0,
  byteSize: 0,
});

let counter = 0;
let store: ChunkStore;
let events: EventStore;

function setup() {
  store = openChunkStore(`store-meeting-events-${++counter}`);
  events = openEventStore(`store-meeting-events-${counter}-events`);
  const warnings: string[] = [];
  const put = (...list: MeetingEvent[]) =>
    storeMeetingEvents(
      { store, events },
      { recordingId: RECORDING_ID, events: list, droppedRanges: [] },
      { now: () => 777, warn: (message) => warnings.push(message) },
    );
  const storedSeqs = async () => (await events.getEvents(RECORDING_ID)).map((row) => row.seq);
  return { put, storedSeqs, warnings };
}

describe('storeMeetingEvents', () => {
  afterEach(async () => Promise.all([store.close(), events.close()]));

  it("stores a recording's events once each, and acks the batch's last seq", async () => {
    const { put, storedSeqs } = setup();
    await store.putRecording(recording('recording'));
    const ack = { type: 'eventsAck', recordingId: RECORDING_ID, seq: 1 };
    expect(await put(STARTED, STOPPED)).toEqual(ack);
    // Its ack was late, and the page sent it again.
    expect(await put(STARTED, STOPPED)).toEqual(ack);
    expect(await storedSeqs()).toEqual([0, 1]);
    expect((await events.getEvents(RECORDING_ID))[1]).toEqual({
      recordingId: RECORDING_ID,
      seq: 1,
      event: STOPPED,
      receivedAt: 777,
    });
  });

  // The stop waits for its events only so long: a few come after the end, or before the start.
  it('stores the events of a recording that ended, or that is not announced yet', async () => {
    const { put, storedSeqs } = setup();
    await put(STARTED);
    await store.putRecording(recording('ended'));
    await put(STOPPED);
    expect(await storedSeqs()).toEqual([0, 1]);
  });

  it('acks and drops the events of a saved recording, with a warning', async () => {
    const { put, storedSeqs, warnings } = setup();
    await store.putRecording(recording('saved'));
    expect(await put(STOPPED)).toEqual({ type: 'eventsAck', recordingId: RECORDING_ID, seq: 1 });
    expect(await storedSeqs()).toEqual([]);
    expect(warnings).toEqual([
      `dropping 1 meeting event(s) of ${RECORDING_ID}: its notes are saved already`,
    ]);
  });
});
