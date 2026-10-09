import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MeetingEvent, MeetingEventBatch } from '@/lib/types';
import { createNotesTracker } from './create-notes-tracker';

const recordingId = '4f3c6d2a-9d7c-4a4e-9f1e-0c1b2a3d4e5f';

/** What the end says of a recording's events. */
interface Counts {
  eventCount: number;
  eventsDropped: number;
  eventsUnsent: number;
}

function setup(isDroppable?: (event: MeetingEvent) => boolean) {
  const batches: MeetingEventBatch[] = [];
  let answer: () => Promise<unknown> = async () => ({ ok: true, rejected: 0 });
  let wall = 1_700_000_000_000;
  const encoder: { media: number; state: RecordingState } = { media: 0, state: 'recording' };
  const recording = {
    id: recordingId,
    encoder: { mediaTimeMs: () => encoder.media, state: () => encoder.state },
  };
  const tracker = createNotesTracker({
    send: (batch) => {
      batches.push(batch);
      return answer();
    },
    now: () => wall,
    ...(isDroppable ? { isDroppable } : {}),
    setTimeout: (handler, ms) => window.setTimeout(handler, ms),
    clearTimeout: (id) => window.clearTimeout(Number(id)),
  });
  return {
    tracker,
    /** The counts `whenSettled` gives, as a promise. */
    settle: (id: string, maxWaitMs: number) =>
      new Promise<Counts>((resolve) => tracker.whenSettled(id, maxWaitMs, resolve)),
    batches,
    recording,
    encoder,
    tick: (ms: number) => {
      wall += ms;
    },
    answerWith: (next: () => Promise<unknown>) => {
      answer = next;
    },
  };
}

describe('createNotesTracker', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("stamps a recording's start and stop with the wall time and its place in the file, in whole milliseconds", async () => {
    const { tracker, settle, batches, recording, encoder, tick } = setup();
    tracker.configure(1);
    tracker.recordingStarted(recording);
    tick(60_000);
    encoder.media = 59_799.6;
    tracker.recordingStopped(recording, 'command');
    expect(await settle(recordingId, 5_000)).toEqual({
      eventCount: 2,
      eventsDropped: 0,
      eventsUnsent: 0,
    });
    expect(batches).toEqual([
      {
        recordingId,
        events: [
          { seq: 0, atMs: 1_700_000_000_000, mediaMs: 0, type: 'recording-started' },
          {
            seq: 1,
            atMs: 1_700_000_060_000,
            mediaMs: 59_800,
            type: 'recording-stopped',
            reason: 'command',
          },
        ],
        droppedRanges: [],
      },
    ]);
  });

  it('marks an event detected while paused', async () => {
    const { tracker, settle, batches, recording, encoder } = setup();
    tracker.configure(1);
    tracker.recordingStarted(recording);
    encoder.state = 'paused';
    tracker.recordingStopped(recording, 'left-meeting');
    await settle(recordingId, 5_000);
    expect(batches[0]?.events[1]).toMatchObject({ type: 'recording-stopped', paused: true });
  });

  // The stop must never wait long for events: the end of the recording comes first.
  it('waits for the events at most as long as it is given, and says what is not sent', async () => {
    const { tracker, settle, recording, answerWith } = setup();
    answerWith(() => new Promise(() => undefined));
    tracker.configure(1);
    tracker.recordingStarted(recording);
    tracker.recordingStopped(recording, 'command');
    const settled = settle(recordingId, 5_000);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(await settled).toEqual({ eventCount: 0, eventsDropped: 0, eventsUnsent: 2 });
  });

  // An older bridge answers no `page:events`: the events wait, and the stop does not.
  it('sends nothing to a bridge that does not speak the events protocol, and does not wait', async () => {
    const { tracker, settle, batches, recording } = setup();
    tracker.configure(0);
    tracker.recordingStarted(recording);
    tracker.recordingStopped(recording, 'command');
    expect(await settle(recordingId, 5_000)).toEqual({
      eventCount: 0,
      eventsDropped: 0,
      eventsUnsent: 2,
    });
    expect(batches).toEqual([]);
    tracker.configure(1);
    await vi.advanceTimersByTimeAsync(0);
    expect(batches).toHaveLength(1);
  });

  it('counts nothing for a recording it does not know', async () => {
    const { settle } = setup();
    expect(await settle(recordingId, 0)).toEqual({
      eventCount: 0,
      eventsDropped: 0,
      eventsUnsent: 0,
    });
  });

  it('says how far it got, for the page debug view', async () => {
    const { tracker, settle, recording } = setup();
    expect(tracker.debug()).toEqual({ protocol: 0, lastSeq: -1, pending: 0, acked: -1 });
    tracker.configure(1);
    tracker.recordingStarted(recording);
    expect(tracker.debug()).toEqual({ protocol: 1, lastSeq: 0, pending: 1, acked: -1 });
    tracker.recordingStopped(recording, 'command');
    await settle(recordingId, 5_000);
    expect(tracker.debug()).toEqual({ protocol: 1, lastSeq: 1, pending: 0, acked: 1 });
  });
});

describe('createNotesTracker, a page that goes away', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  // It runs no later task: the end must have its counts in this one.
  it('settles every wait at once, and each only once', async () => {
    const { tracker, recording, answerWith } = setup();
    answerWith(() => new Promise(() => undefined));
    tracker.configure(1);
    tracker.recordingStarted(recording);
    tracker.recordingStopped(recording, 'command');
    const settled: unknown[] = [];
    tracker.whenSettled(recordingId, 5_000, (counts) => settled.push(counts));
    tracker.settleNow();
    expect(settled).toEqual([{ eventCount: 0, eventsDropped: 0, eventsUnsent: 2 }]);
    await vi.advanceTimersByTimeAsync(5_000);
    tracker.settleNow();
    expect(settled).toHaveLength(1);
  });
});

describe('createNotesTracker, a long queue', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('never drops a start or a stop, however many wait', async () => {
    const { tracker, settle, recording } = setup();
    tracker.recordingStarted(recording);
    for (let stop = 0; stop < 10_000; stop++) tracker.recordingStopped(recording, 'command');
    expect(await settle(recordingId, 0)).toEqual({
      eventCount: 0,
      eventsDropped: 0,
      eventsUnsent: 10_001,
    });
    expect(tracker.debug().pending).toBe(10_001);
  });
});

describe('createNotesTracker, events the queue dropped', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  // Counted in the end only below the last acked seq; the ones after it are unsent.
  it('counts the dropped seqs the bridge got past', async () => {
    // Past the first batch on its way, 10 200 events overflow the queue's 10 000.
    const { tracker, settle, recording } = setup((event) => event.seq > 0 && event.seq < 10_200);
    tracker.configure(1);
    tracker.recordingStarted(recording);
    for (let stop = 0; stop < 10_200; stop++) tracker.recordingStopped(recording, 'command');
    const counts = await settle(recordingId, 5_000);
    expect(counts.eventsDropped).toBeGreaterThan(0);
    expect(counts.eventCount + counts.eventsUnsent).toBe(10_201);
  });
});
