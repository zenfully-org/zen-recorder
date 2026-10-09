import { openDB } from 'idb';
import { afterEach, describe, expect, it } from 'vitest';
import type { MeetingEvent } from '@/lib/types';
import { openChunkStore } from './open-chunk-store';
import { type EventStore, openEventStore } from './open-event-store';

const event = (seq: number): MeetingEvent => ({
  seq,
  atMs: 1_000 + seq,
  mediaMs: seq * 10,
  type: 'recording-started',
});

let counter = 0;
let store: EventStore;
const open = () => {
  store = openEventStore(`events-test-${++counter}`);
  return store;
};

describe('openEventStore', () => {
  afterEach(async () => store.close());

  // A batch sent again (an ack that came late, a bridge reload) leaves one row per seq.
  it('stores each seq of a recording once, in seq order', async () => {
    const events = open();
    await events.putBatch('r1', [event(2), event(0)], 5_000);
    await events.putBatch('r1', [event(0), event(1)], 6_000);
    const stored = await events.getEvents('r1');
    expect(stored.map((row) => [row.seq, row.receivedAt])).toEqual([
      [0, 6_000],
      [1, 6_000],
      [2, 5_000],
    ]);
    expect(stored[0]).toEqual({ recordingId: 'r1', seq: 0, event: event(0), receivedAt: 6_000 });
    expect(await events.countEvents('r1')).toBe(3);
  });

  it("lists the recordings that have events, and deletes one recording's only", async () => {
    const events = open();
    await events.putBatch('r1', [event(0)], 1);
    await events.putBatch('r2', [event(0), event(1)], 1);
    expect((await events.listRecordingIds()).sort()).toEqual(['r1', 'r2']);
    await events.deleteEvents('r2');
    expect(await events.listRecordingIds()).toEqual(['r1']);
    expect(await events.getEvents('r2')).toEqual([]);
    expect(await events.countEvents('r1')).toBe(1);
  });

  // An older build opens 'zen-recorder' at version 1: a version 2 there would stop it recording.
  it('leaves the recordings database as it was', async () => {
    const name = `recordings-${++counter}`;
    const chunks = openChunkStore(name);
    await chunks.listRecordings();
    const events = openEventStore(`${name}-events`);
    store = events;
    await events.putBatch('r1', [event(0)], 1);
    await chunks.close();
    const reopened = await openDB(name);
    expect(reopened.version).toBe(1);
    expect([...reopened.objectStoreNames]).toEqual(['chunks', 'recordings']);
    reopened.close();
  });
});

describe('openEventStore, closing', () => {
  it('closes a store it never opened, and opens it again on the next use', async () => {
    const events = openEventStore(`events-test-${++counter}`);
    await events.close();
    await events.putBatch('r1', [event(0)], 1);
    expect(await events.countEvents('r1')).toBe(1);
    await events.close();
  });
});
