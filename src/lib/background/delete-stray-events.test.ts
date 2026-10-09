import { afterEach, describe, expect, it } from 'vitest';
import { type ChunkStore, openChunkStore } from '@/lib/storage/open-chunk-store';
import { type EventStore, openEventStore } from '@/lib/storage/open-event-store';
import type { MeetingEvent } from '@/lib/types';
import { deleteStrayEvents } from './delete-stray-events';

const HOUR = 60 * 60 * 1000;
const NOW = 100 * HOUR;
const event = (seq: number): MeetingEvent => ({
  seq,
  atMs: 1,
  mediaMs: 0,
  type: 'recording-started',
});

let counter = 0;
let store: ChunkStore;
let events: EventStore;

function setup() {
  store = openChunkStore(`strays-${++counter}`);
  events = openEventStore(`strays-events-${counter}`);
  const warnings: unknown[][] = [];
  const run = (claimed: string[] = []) =>
    deleteStrayEvents({
      events,
      store,
      claimedIds: () => claimed,
      warn: (...args) => warnings.push(args),
      now: () => NOW,
    });
  return { run, warnings };
}

describe('deleteStrayEvents', () => {
  afterEach(async () => Promise.all([store.close(), events.close()]));

  // A recording whose start never came cannot get notes: after a day its events only take space.
  it('deletes the events of a recording never stored once none came for a day', async () => {
    const { run, warnings } = setup();
    await events.putBatch('old', [event(0), event(1)], NOW - 25 * HOUR);
    await events.putBatch('young', [event(0)], NOW - 23 * HOUR);
    await events.putBatch('claimed', [event(0)], NOW - 30 * HOUR);
    await events.putBatch('stored', [event(0)], NOW - 30 * HOUR);
    await store.putRecording({
      id: 'stored',
      meetingCode: 'c',
      title: 't',
      startedAt: 1,
      mimeType: 'audio/webm',
      status: 'saved',
      chunkCount: 0,
      byteSize: 0,
    });
    expect(await run(['claimed'])).toEqual(['old']);
    expect((await events.listRecordingIds()).sort()).toEqual(['claimed', 'stored', 'young']);
    expect(warnings).toEqual([
      [
        'deleted 2 meeting event(s) of old: no recording was stored for them, and none came for 25 h',
      ],
    ]);
  });

  // Their notes deleted them already, unless that delete failed: then this pass does, quietly.
  it('deletes the events of a recording whose notes are written or skipped, at once', async () => {
    const { run, warnings } = setup();
    const recording = (id: string, notesState?: 'saved' | 'skipped' | 'failed') => ({
      id,
      meetingCode: 'c',
      title: 't',
      startedAt: 1,
      mimeType: 'audio/webm',
      status: 'saved' as const,
      chunkCount: 0,
      byteSize: 0,
      ...(notesState ? { notesState } : {}),
    });
    for (const [id, state] of [
      ['written', 'saved'],
      ['off', 'skipped'],
      ['failed', 'failed'],
    ] as const) {
      await store.putRecording(recording(id, state));
      await events.putBatch(id, [event(0)], NOW);
    }
    expect((await run()).sort()).toEqual(['off', 'written']);
    expect(await events.listRecordingIds()).toEqual(['failed']);
    expect(warnings).toEqual([]);
  });

  it('reports what it could not do, and goes on', async () => {
    const { run, warnings } = setup();
    await events.putBatch('a', [event(0)], 0);
    await events.putBatch('b', [event(0)], 0);
    const failing = events.deleteEvents;
    let calls = 0;
    events.deleteEvents = async (id) => {
      if (calls++ === 0) throw new Error('disk gone');
      return failing(id);
    };
    expect(await run()).toEqual(['b']);
    expect(warnings[0]).toEqual([
      'could not delete the stray meeting events of a:',
      new Error('disk gone'),
    ]);
    events.listRecordingIds = async () => {
      throw new Error('closed');
    };
    expect(await run()).toEqual([]);
    expect(warnings.at(-1)).toEqual([
      'could not list the stored meeting events:',
      new Error('closed'),
    ]);
  });
});

describe('deleteStrayEvents, the clock', () => {
  afterEach(async () => Promise.all([store.close(), events.close()]));

  it('reads the time itself when given no clock', async () => {
    store = openChunkStore(`strays-${++counter}`);
    events = openEventStore(`strays-events-${counter}`);
    await events.putBatch('old', [event(0)], 0);
    const deleted = await deleteStrayEvents({
      events,
      store,
      claimedIds: () => [],
      warn: () => undefined,
    });
    expect(deleted).toEqual(['old']);
  });
});
