import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MeetingEventBatch } from '@/lib/types';
import { createNotesTracker } from './create-notes-tracker';

const recordingId = '4f3c6d2a-9d7c-4a4e-9f1e-0c1b2a3d4e5f';
/** A bridge that takes meeting events, with notes on. */
const on = { eventsProtocol: 1, meetingNotes: 'withNames' } as const;
/** A recording that started by itself in meeting `abc-defg-hij`, with video. */
const AUTO = { trigger: 'firstRemote', meetingId: 'abc-defg-hij', audioOnlyReason: null } as const;
/** What the page sees as the recording starts: a call that is connected. */
const SEEN = { connected: true } as const;

/** What the end says of a recording's events. */
interface Counts {
  eventCount: number;
  eventsDropped: number;
  eventsUnsent: number;
}

function setup() {
  const batches: MeetingEventBatch[] = [];
  let answer: () => Promise<unknown> = async () => ({ ok: true, rejected: 0 });
  let wall = 1_700_000_000_000;
  const encoder: { media: number; state: RecordingState } = { media: 0, state: 'recording' };
  const recording = {
    id: recordingId,
    encoder: { mediaTimeMs: () => encoder.media, state: () => encoder.state },
    video: {},
  };
  const tracker = createNotesTracker({
    send: (batch) => {
      batches.push(batch);
      return answer();
    },
    now: () => wall,
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

type Recording = ReturnType<typeof setup>['recording'];

/** `recording` whose encoder's `part` is where the script is stopped: it throws, uncatchable. */
const cutShortAt = (recording: Recording, part: 'state' | 'mediaTimeMs'): Recording => {
  const stopped = (): never => {
    throw new Error('script stopped');
  };
  return {
    id: recording.id,
    encoder: {
      mediaTimeMs: part === 'mediaTimeMs' ? stopped : recording.encoder.mediaTimeMs,
      state: part === 'state' ? stopped : recording.encoder.state,
    },
    video: recording.video,
  };
};

describe('createNotesTracker', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("stamps a recording's start and stop with the wall time and its place in the file, in whole milliseconds", async () => {
    const { tracker, settle, batches, recording, encoder, tick } = setup();
    tracker.configure(on);
    tracker.recordingStarted(recording, AUTO, SEEN);
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
          {
            seq: 0,
            atMs: 1_700_000_000_000,
            mediaMs: 0,
            type: 'recording-started',
            cause: 'auto-first-remote',
            media: 'video',
            audioOnlyReason: null,
            continuesRecordingId: null,
            gapMs: null,
            mic: null,
            tabVisible: null,
            ownShare: null,
          },
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
    tracker.configure(on);
    tracker.recordingStarted(recording, AUTO, SEEN);
    encoder.state = 'paused';
    tracker.recordingStopped(recording, 'left-meeting');
    await settle(recordingId, 5_000);
    expect(batches[0]?.events[1]).toMatchObject({ type: 'recording-stopped', paused: true });
  });

  // The stop must never wait long for events: the end of the recording comes first.
  it('waits for the events at most as long as it is given, and says what is not sent', async () => {
    const { tracker, settle, recording, answerWith } = setup();
    answerWith(() => new Promise(() => undefined));
    tracker.configure(on);
    tracker.recordingStarted(recording, AUTO, SEEN);
    tracker.recordingStopped(recording, 'command');
    const settled = settle(recordingId, 5_000);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(await settled).toEqual({ eventCount: 0, eventsDropped: 0, eventsUnsent: 2 });
  });

  // An older bridge answers no `page:events`: the events wait, and the stop does not.
  it('sends nothing to a bridge that does not speak the events protocol, and does not wait', async () => {
    const { tracker, settle, batches, recording } = setup();
    tracker.configure({ eventsProtocol: 0, meetingNotes: 'withNames' });
    tracker.recordingStarted(recording, AUTO, SEEN);
    tracker.recordingStopped(recording, 'command');
    expect(await settle(recordingId, 5_000)).toEqual({
      eventCount: 0,
      eventsDropped: 0,
      eventsUnsent: 2,
    });
    expect(batches).toEqual([]);
    tracker.configure(on);
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
    tracker.configure(on);
    tracker.recordingStarted(recording, AUTO, SEEN);
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
    tracker.configure(on);
    tracker.recordingStarted(recording, AUTO, SEEN);
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

describe('createNotesTracker, what it stamps', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('stamps nothing of a recording started while the notes are off', async () => {
    const { tracker, settle, batches, recording } = setup();
    tracker.configure({ eventsProtocol: 1, meetingNotes: 'off' });
    tracker.recordingStarted(recording, AUTO, SEEN);
    // Turned on again meanwhile: its stop is stamped no more than its start.
    tracker.configure(on);
    tracker.recordingStopped(recording, 'command');
    expect(await settle(recordingId, 5_000)).toEqual({
      eventCount: 0,
      eventsDropped: 0,
      eventsUnsent: 0,
    });
    expect(batches).toEqual([]);
  });

  // A page that goes away hands its recording over in `pagehide`, and again if Firefox cut it short.
  it('stamps one start and one stop per recording', async () => {
    const { tracker, settle, batches, recording } = setup();
    tracker.configure(on);
    tracker.recordingStarted(recording, AUTO, SEEN);
    tracker.recordingStarted(recording, AUTO, SEEN);
    tracker.recordingStopped(recording, 'pagehide');
    tracker.recordingStopped(recording, 'pagehide');
    await settle(recordingId, 5_000);
    expect(batches.flatMap((batch) => batch.events.map((event) => event.type))).toEqual([
      'recording-started',
      'recording-stopped',
    ]);
  });

  // Firefox stops a closing tab's script once, at its next call, and the bridge then asks again.
  it.each(['state', 'mediaTimeMs'] as const)(
    'stamps the stop on the next call when the first was stopped reading the encoder (%s)',
    async (part) => {
      const { tracker, settle, batches, recording } = setup();
      tracker.configure(on);
      tracker.recordingStarted(recording, AUTO, SEEN);
      expect(() => tracker.recordingStopped(cutShortAt(recording, part), 'pagehide')).toThrow();
      tracker.recordingStopped(recording, 'pagehide');
      tracker.recordingStopped(recording, 'pagehide');
      expect(tracker.counts(recordingId)).toEqual({
        eventCount: 0,
        eventsDropped: 0,
        eventsUnsent: 2,
      });
      await settle(recordingId, 5_000);
      expect(batches.flatMap((batch) => batch.events.map((e) => `${e.seq} ${e.type}`))).toEqual([
        '0 recording-started',
        '1 recording-stopped',
      ]);
    },
  );

  // An end that cannot wait for the bridge: a page that goes away runs no later task.
  it('counts the events as they stand, at once', () => {
    const { tracker, recording } = setup();
    tracker.configure(on);
    tracker.recordingStarted(recording, AUTO, SEEN);
    tracker.recordingStopped(recording, 'pagehide');
    expect(tracker.counts(recordingId)).toEqual({
      eventCount: 0,
      eventsDropped: 0,
      eventsUnsent: 2,
    });
    expect(tracker.counts('another')).toEqual({ eventCount: 0, eventsDropped: 0, eventsUnsent: 0 });
  });
});

describe('createNotesTracker, why a recording started', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const NEXT = '4f3c6d2a-9d7c-4a4e-9f1e-0c1b2a3d4e51';
  const audioOnly = (id: string) => ({
    id,
    encoder: { mediaTimeMs: () => 0, state: (): RecordingState => 'recording' },
    video: null,
  });

  it('stamps the start with why it started, what it records, what it goes on from and its states', async () => {
    const { tracker, batches, recording, tick } = setup();
    tracker.configure(on);
    tracker.recordingStarted(recording, AUTO, SEEN);
    tracker.recordingStopped(recording, 'encoder-error');
    tick(140);
    const restart = {
      trigger: 'encoder-error',
      meetingId: AUTO.meetingId,
      audioOnlyReason: 'video-failed',
    } as const;
    tracker.recordingStarted(audioOnly(NEXT), restart, SEEN);
    // A start goes out 2 s after it, with whatever came meanwhile.
    await vi.advanceTimersByTimeAsync(2_000);
    expect(batches.find((batch) => batch.recordingId === NEXT)?.events).toEqual([
      {
        seq: 0,
        atMs: 1_700_000_000_140,
        mediaMs: 0,
        type: 'recording-started',
        cause: 'restart-after-video-failure',
        audioOnlyReason: 'video-failed',
        continuesRecordingId: recordingId,
        gapMs: 140,
        media: 'audio',
        mic: null,
        tabVisible: null,
        ownShare: null,
      },
    ]);
  });

  // The link is to a file: one recorded with the notes off is a file all the same, and the notes
  // setting can be turned on before a recording is saved.
  it('says why a recording started with the notes off too, and links the next one to it', () => {
    const { tracker, batches, recording, tick } = setup();
    tracker.configure({ eventsProtocol: 1, meetingNotes: 'off' });
    expect(tracker.recordingStarted(recording, AUTO, SEEN)).toMatchObject({
      cause: 'auto-first-remote',
    });
    tracker.recordingStopped(recording, 'command');
    tick(2_000);
    expect(
      tracker.recordingStarted(audioOnly(NEXT), { ...AUTO, trigger: 'command' }, SEEN),
    ).toEqual({
      cause: 'manual',
      audioOnlyReason: null,
      continuesRecordingId: recordingId,
      gapMs: 2_000,
    });
    expect(batches).toEqual([]);
  });
});

describe('createNotesTracker, what happens to a recording', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('stamps the video failing and the restarts given up, before the stop and with its place in the file', async () => {
    const { tracker, settle, batches, recording, encoder, tick } = setup();
    tracker.configure(on);
    tracker.recordingStarted(recording, AUTO, SEEN);
    tick(4_000);
    encoder.media = 3_950.4;
    tracker.record(recording, { type: 'video-failed' });
    encoder.state = 'paused';
    tracker.record(recording, { type: 'restarts-exhausted', failures: 4 });
    tracker.recordingStopped(recording, 'encoder-error');
    // After the stop, and for no recording, nothing more.
    tracker.record(recording, { type: 'video-failed' });
    tracker.record(null, { type: 'video-failed' });
    await settle(recordingId, 5_000);
    expect(batches.flatMap((batch) => batch.events).slice(1)).toEqual([
      { seq: 1, atMs: 1_700_000_004_000, mediaMs: 3_950, type: 'video-failed' },
      {
        seq: 2,
        atMs: 1_700_000_004_000,
        mediaMs: 3_950,
        paused: true,
        type: 'restarts-exhausted',
        failures: 4,
      },
      expect.objectContaining({ seq: 3, type: 'recording-stopped', reason: 'encoder-error' }),
    ]);
  });

  it('stamps nothing for a recording it does not track', async () => {
    const { tracker, batches, recording } = setup();
    tracker.configure({ eventsProtocol: 1, meetingNotes: 'off' });
    tracker.recordingStarted(recording, AUTO, SEEN);
    tracker.record(recording, { type: 'video-failed' });
    await vi.advanceTimersByTimeAsync(5_000);
    expect(batches).toEqual([]);
  });
});

describe('createNotesTracker, pauses', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const stamped = (batches: MeetingEventBatch[]) =>
    batches.flatMap((batch) => batch.events).map(({ seq: _seq, ...event }) => event);

  // The pause is stamped before the encoder pauses and the resume after it resumes: both at the
  // place the pause cut the file, neither "while paused".
  it('stamps a pause and a resume at the place the pause cut the file, and how long it lasted', async () => {
    const { tracker, settle, batches, recording, encoder, tick } = setup();
    tracker.configure(on);
    tracker.recordingStarted(recording, AUTO, SEEN);
    tick(3_000);
    encoder.media = 3_000;
    tracker.paused(recording);
    encoder.state = 'paused';
    tick(4_000);
    encoder.state = 'recording';
    tracker.resumed(recording);
    tracker.recordingStopped(recording, 'command');
    await settle(recordingId, 5_000);
    expect(stamped(batches).slice(1, 3)).toEqual([
      { atMs: 1_700_000_003_000, mediaMs: 3_000, type: 'recording-paused' },
      { atMs: 1_700_000_007_000, mediaMs: 3_000, type: 'recording-resumed', pausedMs: 4_000 },
    ]);
    expect(tracker.pausedMs(recordingId)).toBe(4_000);
  });

  it('ends a pause with the stop, and counts the pauses of a recording it stamps nothing of', () => {
    const { tracker, recording, tick } = setup();
    tracker.configure({ eventsProtocol: 1, meetingNotes: 'off' });
    tracker.recordingStarted(recording, AUTO, SEEN);
    tracker.paused(recording);
    tick(2_500);
    tracker.recordingStopped(recording, 'command');
    tick(10_000);
    expect(tracker.pausedMs(recordingId)).toBe(2_500);
    // Nothing is paused or resumed while no recording runs.
    tracker.paused(null);
    tracker.resumed(null);
    expect(tracker.pausedMs('another')).toBe(0);
  });
});

describe('createNotesTracker, the connection and reloads', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const types = (batches: MeetingEventBatch[]) =>
    batches.flatMap((batch) => batch.events).map((event) => event.type);

  it('writes a connection lost for 3 s as lost, stamped when it went, then restored', async () => {
    const { tracker, settle, batches, recording, encoder, tick } = setup();
    tracker.configure(on);
    // The start is the baseline: the first loss after it is one, read before any tick or not.
    tracker.recordingStarted(recording, AUTO, SEEN);
    tick(5_000);
    encoder.media = 5_000;
    tracker.observe(recording, { connected: false });
    tick(1_000);
    encoder.media = 6_000;
    // A second down is a blip: nothing yet.
    tracker.observe(recording, { connected: false });
    tick(1_000);
    tracker.observe(recording, { connected: false });
    tick(1_000);
    tracker.observe(recording, { connected: true });
    tracker.recordingStopped(recording, 'command');
    // Nothing after the stop.
    tracker.observe(recording, { connected: false });
    tracker.observe(null, { connected: false });
    await settle(recordingId, 5_000);
    const events = batches.flatMap((batch) => batch.events);
    expect(events.slice(1, 3)).toEqual([
      { seq: 1, atMs: 1_700_000_005_000, mediaMs: 5_000, type: 'connection-lost' },
      {
        seq: 2,
        atMs: 1_700_000_008_000,
        mediaMs: 6_000,
        type: 'connection-restored',
        lostMs: 3_000,
      },
    ]);
  });

  it('writes nothing of a recording started with the notes off', async () => {
    const { tracker, batches, recording, tick } = setup();
    tracker.configure({ eventsProtocol: 1, meetingNotes: 'off' });
    tracker.recordingStarted(recording, AUTO, SEEN);
    tracker.observe(recording, { connected: true });
    tracker.observe(recording, { connected: false });
    tick(3_000);
    tracker.observe(recording, { connected: false });
    await vi.advanceTimersByTimeAsync(5_000);
    expect(batches).toEqual([]);
  });

  // A settings edit keeps the bridge, and its id; a reload or an update brings a new one.
  it('writes an extension reload when a new bridge configures the page while it records', async () => {
    const { tracker, settle, batches, recording } = setup();
    tracker.configure({ ...on, bridgeId: 'first' }, null);
    tracker.recordingStarted(recording, AUTO, SEEN);
    tracker.configure({ ...on, bridgeId: 'first' }, recording);
    tracker.configure({ ...on }, recording);
    tracker.configure({ ...on, bridgeId: '' }, recording);
    tracker.configure({ ...on, bridgeId: 'second' }, recording);
    tracker.recordingStopped(recording, 'command');
    tracker.configure({ ...on, bridgeId: 'third' }, null);
    await settle(recordingId, 5_000);
    expect(types(batches)).toEqual([
      'recording-started',
      'extension-reloaded',
      'recording-stopped',
    ]);
  });
});
