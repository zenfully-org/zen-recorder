import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MeetingPresence } from '@/lib/providers/types';
import type { MeetingEventBatch } from '@/lib/types';
import { createNotesTracker } from './create-notes-tracker';
import type { PresenceSource } from './create-presence-events';

const recordingId = '4f3c6d2a-9d7c-4a4e-9f1e-0c1b2a3d4e5f';
/** A bridge that takes meeting events, with notes on. */
const on = { eventsProtocol: 1, meetingNotes: 'withNames' } as const;
/** A recording that started by itself in meeting `abc-defg-hij`, with video. */
const AUTO = { trigger: 'firstRemote', meetingId: 'abc-defg-hij', audioOnlyReason: null } as const;
/** What the page shows as the recording starts: a connected call, the microphone on, in front. */
const SEEN = { connected: true, mic: 'live', title: 'Standup', visible: true } as const;

/** What the end says of a recording's events. */
interface Counts {
  eventCount: number;
  eventsDropped: number;
  eventsUnsent: number;
}

function setup(options: { presence?: PresenceSource } = {}) {
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
    ...(options.presence ? { presence: options.presence } : {}),
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

/** The types of the events sent, in order. */
const types = (batches: MeetingEventBatch[]) =>
  batches.flatMap((batch) => batch.events).map((event) => event.type);

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
            mic: 'live',
            tabVisible: true,
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
        mic: 'live',
        tabVisible: true,
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

  it('writes a connection lost for 3 s as lost, stamped when it went, then restored', async () => {
    const { tracker, settle, batches, recording, encoder, tick } = setup();
    tracker.configure(on);
    // The start is the baseline: the first loss after it is one, read before any tick or not.
    tracker.recordingStarted(recording, AUTO, SEEN);
    tick(5_000);
    encoder.media = 5_000;
    tracker.observe(recording, { ...SEEN, connected: false });
    tick(1_000);
    encoder.media = 6_000;
    // A second down is a blip: nothing yet.
    tracker.observe(recording, { ...SEEN, connected: false });
    tick(1_000);
    tracker.observe(recording, { ...SEEN, connected: false });
    tick(1_000);
    tracker.observe(recording, { ...SEEN, connected: true });
    tracker.recordingStopped(recording, 'command');
    // Nothing after the stop.
    tracker.observe(recording, { ...SEEN, connected: false });
    tracker.observe(null, { ...SEEN, connected: false });
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
    tracker.observe(recording, { ...SEEN, connected: true });
    tracker.observe(recording, { ...SEEN, connected: false });
    tick(3_000);
    tracker.observe(recording, { ...SEEN, connected: false });
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

describe('createNotesTracker, the microphone, the title and the tab', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  // A state that never changes is still written: in the start, with nothing after it.
  it('says a recording started muted, in a hidden tab, in its start, and opens the hidden span there', async () => {
    const { tracker, settle, batches, recording } = setup();
    tracker.configure(on);
    tracker.recordingStarted(recording, AUTO, { ...SEEN, mic: 'muted', visible: false });
    tracker.recordingStopped(recording, 'command');
    await settle(recordingId, 5_000);
    const events = batches.flatMap((batch) => batch.events);
    expect(events[0]).toMatchObject({ type: 'recording-started', mic: 'muted', tabVisible: false });
    expect(events.slice(1).map(({ seq, type, mediaMs }) => ({ seq, type, mediaMs }))).toEqual([
      { seq: 1, type: 'coverage-lost', mediaMs: 0 },
      { seq: 2, type: 'recording-stopped', mediaMs: 0 },
    ]);
  });

  it('writes a mute held 5 s, a new title and a hidden tab, each as of when it began', async () => {
    const { tracker, settle, batches, recording, encoder, tick } = setup();
    tracker.configure(on);
    tracker.recordingStarted(recording, AUTO, SEEN);
    tick(2_000);
    encoder.media = 2_000;
    tracker.observe(recording, { ...SEEN, mic: 'muted', title: 'Planning', visible: false });
    // The next tick: hidden for over a second.
    tick(1_500);
    tracker.observe(recording, { ...SEEN, mic: 'muted', title: 'Planning', visible: false });
    tick(3_500);
    encoder.media = 7_000;
    tracker.observe(recording, { ...SEEN, mic: 'muted', title: 'Planning' });
    tracker.recordingStopped(recording, 'command');
    await settle(recordingId, 5_000);
    const told = batches.flatMap((batch) => batch.events).slice(1, -1);
    expect(told.map(({ type, atMs, mediaMs }) => ({ type, atMs, mediaMs }))).toEqual([
      { type: 'coverage-lost', atMs: 1_700_000_002_000, mediaMs: 2_000 },
      { type: 'mic', atMs: 1_700_000_002_000, mediaMs: 2_000 },
      { type: 'title-changed', atMs: 1_700_000_002_000, mediaMs: 2_000 },
      { type: 'coverage-restored', atMs: 1_700_000_007_000, mediaMs: 7_000 },
    ]);
  });
});

const person = (name: string, self = false) => ({ key: `name:${name}`, name, self });
/** A page whose reading the test sets, and how often the tracker read it. */
function page(people: string[]) {
  const call = (names: string[]): MeetingPresence => ({
    participants: [person('Jo', true), ...names.map((name) => person(name))],
    source: 'stage',
    count: names.length + 1,
    share: { kind: 'none' },
    selfMic: null,
  });
  const state: { reading: MeetingPresence | null; reads: number } = {
    reading: call(people),
    reads: 0,
  };
  const presence: PresenceSource = {
    read: () => {
      state.reads += 1;
      return state.reading;
    },
    capabilities: { count: true, roster: false, self: true, share: true, shareBy: true },
  };
  return { state, presence, call };
}
const told = (batches: MeetingEventBatch[]) =>
  batches
    .flatMap((batch) => batch.events)
    .map(({ seq, type, mediaMs, ...rest }) => {
      const who = 'participant' in rest ? rest.participant?.name : undefined;
      const paused = rest.paused ? ' (paused)' : '';
      return `${seq} ${type}${who ? ` ${who}` : ''} @${mediaMs}${paused}`;
    });

describe('createNotesTracker, who is in the call', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('writes who is in the call at the start, who joins and leaves, and who is there at the stop', async () => {
    const { state, presence, call } = page(['Ana']);
    const { tracker, settle, batches, recording, encoder, tick } = setup({ presence });
    tracker.configure(on);
    tracker.recordingStarted(recording, AUTO, SEEN);
    tick(1_000);
    encoder.media = 1_000;
    state.reading = call(['Ana', 'Ben']);
    tracker.observePresence(recording);
    tick(1_000);
    encoder.media = 2_000;
    state.reading = call(['Ben']);
    tracker.observePresence(recording);
    tick(1_000);
    encoder.media = 3_000;
    tracker.recordingStopped(recording, 'command');
    await settle(recordingId, 5_000);
    expect(told(batches)).toEqual([
      '0 recording-started @0',
      '1 roster @0',
      '2 participant-joined Ben @1000',
      '3 participant-left Ana @2000',
      '4 roster @3000',
      '5 recording-stopped @3000',
    ]);
    expect(batches[0]?.events[1]).toMatchObject({
      why: 'start',
      participants: [{ id: 'p1' }, { id: 'p2' }],
    });
    expect(batches[0]?.events[4]).toMatchObject({ why: 'stop', count: 2, stale: false });
  });

  it('marks what it sees while paused', async () => {
    const { state, presence, call } = page(['Ana']);
    const { tracker, settle, batches, recording, encoder } = setup({ presence });
    tracker.configure(on);
    tracker.recordingStarted(recording, AUTO, SEEN);
    encoder.state = 'paused';
    state.reading = call(['Ana', 'Ben']);
    tracker.observePresence(recording);
    tracker.recordingStopped(recording, 'command');
    await settle(recordingId, 5_000);
    expect(told(batches)[2]).toBe('2 participant-joined Ben @0 (paused)');
  });

  it('reads nothing for a recording it does not track, and nothing after its stop', () => {
    const { state, presence } = page(['Ana']);
    const { tracker, recording } = setup({ presence });
    tracker.configure({ eventsProtocol: 1, meetingNotes: 'off' });
    tracker.recordingStarted(recording, AUTO, SEEN);
    tracker.observePresence(recording);
    tracker.observePresence(null);
    tracker.recordingStopped(recording, 'command');
    expect(state.reads).toBe(0);
  });

  it('writes the stop of the people once, when Firefox cut the first stop short', async () => {
    const { presence } = page(['Ana']);
    const { tracker, settle, batches, recording } = setup({ presence });
    tracker.configure(on);
    tracker.recordingStarted(recording, AUTO, SEEN);
    expect(() => tracker.recordingStopped(cutShortAt(recording, 'state'), 'pagehide')).toThrow();
    tracker.recordingStopped(recording, 'pagehide');
    await settle(recordingId, 5_000);
    expect(types(batches)).toEqual(['recording-started', 'roster', 'roster', 'recording-stopped']);
  });

  it('says again who is in the call when a new bridge configures the page', async () => {
    const { presence } = page(['Ana']);
    const { tracker, settle, batches, recording } = setup({ presence });
    tracker.configure({ ...on, bridgeId: 'first' });
    tracker.recordingStarted(recording, AUTO, SEEN);
    tracker.configure({ ...on, bridgeId: 'second' }, recording);
    tracker.recordingStopped(recording, 'command');
    await settle(recordingId, 5_000);
    expect(types(batches)).toEqual([
      'recording-started',
      'roster',
      'extension-reloaded',
      'roster',
      'roster',
      'recording-stopped',
    ]);
    expect(batches[0]?.events[3]).toMatchObject({ why: 'reannounce' });
  });

  it("keeps the meeting's ids across its recordings, and starts again in another meeting", async () => {
    const { state, presence, call } = page(['Ben']);
    const { tracker, settle, batches, recording } = setup({ presence });
    tracker.configure(on);
    tracker.recordingStarted(recording, AUTO, SEEN);
    tracker.recordingStopped(recording, 'command');
    state.reading = call(['Ana', 'Ben']);
    const second = { ...recording, id: 'b2b7a1f3-5a6e-4c2d-8e9f-0a1b2c3d4e5f' };
    tracker.recordingStarted(second, AUTO, SEEN);
    tracker.recordingStopped(second, 'command');
    const third = { ...recording, id: 'c3c8b2a4-6b7f-4d3e-9fa0-1b2c3d4e5f60' };
    tracker.recordingStarted(third, { ...AUTO, meetingId: 'xyz-wxyz-xyz' }, SEEN);
    tracker.recordingStopped(third, 'command');
    await Promise.all([
      settle(recordingId, 5_000),
      settle(second.id, 5_000),
      settle(third.id, 5_000),
    ]);
    const starts = batches
      .flatMap((batch) => batch.events)
      .flatMap((event) => (event.type === 'roster' && event.why === 'start' ? [event] : []));
    const named = starts.map((roster) => roster.participants.map((ref) => `${ref.id}:${ref.name}`));
    expect(named).toEqual([
      ['p1:Jo', 'p2:Ben'],
      ['p1:Jo', 'p3:Ana', 'p2:Ben'],
      ['p1:Jo', 'p2:Ana', 'p3:Ben'],
    ]);
  });

  it('says nothing of people without a reading of them', async () => {
    const { tracker, settle, batches, recording } = setup();
    tracker.configure({ ...on, bridgeId: 'first' });
    tracker.recordingStarted(recording, AUTO, SEEN);
    tracker.observePresence(recording);
    tracker.configure({ ...on, bridgeId: 'second' }, recording);
    tracker.recordingStopped(recording, 'command');
    await settle(recordingId, 5_000);
    expect(types(batches)).toEqual([
      'recording-started',
      'extension-reloaded',
      'recording-stopped',
    ]);
  });

  it('writes no names while the notes are kept without them', async () => {
    const { presence } = page(['Ana']);
    const { tracker, settle, batches, recording } = setup({ presence });
    tracker.configure({ eventsProtocol: 1, meetingNotes: 'withoutNames' });
    tracker.recordingStarted(recording, AUTO, SEEN);
    tracker.recordingStopped(recording, 'command');
    await settle(recordingId, 5_000);
    expect(JSON.stringify(batches)).not.toMatch(/Jo|Ana/);
    expect(batches[0]?.events[1]).toMatchObject({ participants: [{ id: 'p1' }, { id: 'p2' }] });
  });
});
