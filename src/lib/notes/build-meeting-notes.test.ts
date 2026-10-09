import { describe, expect, it } from 'vitest';
import type { StoredNotesEvent } from '@/lib/notes/map-notes-events';
import { parseMeetingNotes } from '@/lib/notes/parse-meeting-notes';
import { renderMeetingNotes } from '@/lib/notes/render-meeting-notes';
import { buildMeetingNotes, type MeetingNotesInput } from './build-meeting-notes';

/** 2026-10-04 14:03:05 in Berlin (UTC+02:00). */
const START = Date.UTC(2026, 9, 4, 12, 3, 5);
const at = (seconds: number) => START + seconds * 1000;

const jo = { id: 'p1', name: 'Jo Rocha', self: true } as const;
const ana = { id: 'p2', name: 'Ana Souza', self: false } as const;
const ben = { id: 'p3', name: 'Ben Carter', self: false, identity: 'service-id' } as const;

const started: StoredNotesEvent = {
  seq: 0,
  type: 'recording-started',
  atMs: at(0),
  mediaMs: 0,
  cause: 'auto-first-remote',
  media: 'video',
  audioOnlyReason: null,
  continuesRecordingId: null,
  gapMs: null,
  mic: 'live',
  tabVisible: true,
  ownShare: false,
};
const roster = (
  seq: number,
  why: 'start' | 'stop',
  seconds: number,
  mediaMs: number,
  people: readonly (typeof jo | typeof ana | typeof ben)[] = [jo, ana],
) =>
  ({
    seq,
    type: 'roster',
    atMs: at(seconds),
    mediaMs,
    why,
    source: 'stage',
    participants: [...people],
    count: people.length,
    share: 'none',
    shareBy: null,
    stale: false,
    readAtMs: at(seconds),
    capabilities:
      why === 'start'
        ? { count: true, roster: false, self: true, share: true, shareBy: false }
        : null,
  }) satisfies StoredNotesEvent;
/** The stop, 600 s after the start: 540 s into the file after the 60 s pause, plus its offset. */
const stopped = (seq: number): StoredNotesEvent => ({
  seq,
  type: 'recording-stopped',
  atMs: at(600),
  mediaMs: 540_010,
  reason: 'command',
});

/** A ten-minute Meet recording with a pause: start, its roster, a join, the stop roster, stop. */
const EVENTS: StoredNotesEvent[] = [
  started,
  roster(1, 'start', 0, 0),
  {
    seq: 2,
    type: 'participant-joined',
    atMs: at(60),
    mediaMs: 60_000,
    participant: ben,
    count: 3,
  },
  { seq: 3, type: 'recording-paused', atMs: at(120), mediaMs: 120_000 },
  { seq: 4, type: 'recording-resumed', atMs: at(180), mediaMs: 120_000, pausedMs: 60_000 },
  roster(5, 'stop', 600, 540_010, [jo, ana, ben]),
  stopped(6),
];

const input = (patch: Partial<MeetingNotesInput> = {}): MeetingNotesInput => ({
  recording: {
    id: 'rec-1',
    service: 'meet',
    serviceName: 'Google Meet',
    meetingId: 'abc-defg-hij',
    title: 'Weekly product sync',
    url: 'https://meet.google.com/abc-defg-hij',
    startedAt: START,
    lastChunkAt: at(599),
    timeZone: 'Europe/Berlin',
    hasVideo: true,
    recovered: false,
    endReason: 'command',
    eventsProtocol: 1,
    eventCount: 7,
    eventsUnsent: 0,
    eventsDropped: 0,
    eventsCapped: 0,
  },
  events: EVENTS,
  file: {
    saved: '/srv/recordings/zen-recorder/2026-10-04_14-03_Weekly product sync.webm',
    raw: null,
    durationMs: 540_010,
    startOffsetMs: 10,
    remuxed: true,
  },
  previousFile: null,
  notes: 'withNames',
  notesOffWhileRecording: false,
  timeZone: 'Europe/Berlin',
  generatorVersion: '0.4.0',
  detectionLatencyMs: 1000,
  ...patch,
});

const withRecording = (patch: Partial<MeetingNotesInput['recording']>) =>
  input({ recording: { ...input().recording, ...patch } });

describe('buildMeetingNotes: the recording and its file', () => {
  it('describes a complete recording', () => {
    const notes = buildMeetingNotes(input());
    expect(notes.recording).toEqual({
      id: 'rec-1',
      file: '2026-10-04_14-03_Weekly product sync.webm',
      rawFile: null,
      start: '2026-10-04T14:03:05+02:00',
      end: '2026-10-04T14:13:05+02:00',
      timeZone: 'Europe/Berlin',
      durationMs: 540_000,
      pausedMs: 60_000,
      mediaOffsetMs: 10,
      media: 'video+audio',
      audioOnlyReason: null,
      seekable: true,
      recovered: false,
      endEstimated: false,
      startCause: 'auto-first-remote',
      endReason: 'command',
      continues: null,
    });
    expect(notes.capture).toMatchObject({
      events: 'complete',
      eventsMissingReason: null,
      names: true,
      participantSource: 'stage',
      detectionLatencyMs: 1000,
      signals: {
        participants: 'partial',
        joinLeave: 'observed',
        share: 'observed',
        shareBy: 'not-available',
        self: 'observed',
        mic: 'observed',
      },
    });
    expect(notes.meeting).toEqual({
      service: 'meet',
      serviceName: 'Google Meet',
      id: 'abc-defg-hij',
      title: 'Weekly product sync',
      url: 'https://meet.google.com/abc-defg-hij',
    });
    // Every offset is in the file: the remux moved every timestamp by its start offset.
    expect(notes.events.map((event) => event.mediaMs)).toEqual([
      0, 0, 59_990, 119_990, 119_990, 540_000, 540_000,
    ]);
  });

  it('builds a document the format accepts, and that a notes file carries whole', () => {
    const notes = buildMeetingNotes(input());
    expect(parseMeetingNotes(renderMeetingNotes(notes))).toEqual(notes);
  });

  it('names the raw copy by its file name', () => {
    const notes = buildMeetingNotes(
      input({
        file: { ...input().file, raw: 'D:\\Recordings\\zen-recorder\\X raw.webm' },
      }),
    );
    expect(notes.recording.rawFile).toBe('X raw.webm');
  });

  it('says a file that could not be remuxed cannot seek, and has no offset to take off', () => {
    const notes = buildMeetingNotes(
      input({ file: { ...input().file, remuxed: false, durationMs: null, startOffsetMs: 0 } }),
    );
    expect(notes.recording).toMatchObject({ seekable: false, durationMs: null, mediaOffsetMs: 0 });
    expect(notes.events.map((event) => event.mediaMs)).toEqual([
      0, 0, 60_000, 120_000, 120_000, 540_010, 540_010,
    ]);
  });

  it.each([
    ['zero', 0],
    ['negative', -40],
  ])('takes nothing off the offsets when the start offset is %s', (_label, startOffsetMs) => {
    const notes = buildMeetingNotes(
      input({ file: { ...input().file, startOffsetMs, durationMs: 540_010 } }),
    );
    expect(notes.recording.mediaOffsetMs).toBe(0);
    expect(notes.events[2]?.mediaMs).toBe(60_000);
  });

  it('places an event past the end of the file at its end, and says so', () => {
    const notes = buildMeetingNotes(input({ file: { ...input().file, durationMs: 500_010 } }));
    expect(notes.events.at(-1)).toMatchObject({ mediaMs: 500_000, clamped: true });
    expect(notes.events[2]).not.toHaveProperty('clamped');
  });

  it('writes no absolute path, no URL query or fragment, whatever the input holds', () => {
    const notes = buildMeetingNotes(
      withRecording({ url: 'https://zoom.us/j/123?pwd=SECRET&uname=x#success' }),
    );
    const text = renderMeetingNotes(notes);
    expect(notes.meeting.url).toBe('https://zoom.us/j/123');
    expect(text).not.toMatch(/SECRET|uname|#success|\/srv\/recordings/);
  });

  it('writes the times in the time zone of now when the recording was stored without one', () => {
    const notes = buildMeetingNotes({ ...withRecording({ timeZone: undefined }), timeZone: 'UTC' });
    expect(notes.recording).toMatchObject({ start: '2026-10-04T12:03:05+00:00', timeZone: 'UTC' });
  });

  it('knows no end of a recording with neither an event nor a chunk', () => {
    const notes = buildMeetingNotes({
      ...withRecording({ lastChunkAt: undefined, eventsProtocol: 0, recovered: true }),
      events: [],
      file: { ...input().file, durationMs: null },
    });
    expect(notes.recording).toMatchObject({
      end: null,
      endEstimated: false,
      pausedMs: 0,
      durationMs: null,
    });
    expect(notes.events).toEqual([]);
  });

  it("ends a recovered recording's timeline at its last event when the file has no known length", () => {
    const events = EVENTS.filter((event) => event.type !== 'recording-stopped');
    const notes = buildMeetingNotes({
      ...withRecording({ recovered: true }),
      events,
      file: { ...input().file, durationMs: null },
    });
    expect(notes.events.at(-1)).toMatchObject({ source: 'background', mediaMs: 540_000 });
  });

  it('counts a pause the recording ended in up to its end', () => {
    const events = EVENTS.filter((event) => event.type !== 'recording-resumed');
    expect(buildMeetingNotes({ ...input(), events }).recording.pausedMs).toBe(480_000);
  });

  it('says why a file holds audio only, when its start says', () => {
    const audio: StoredNotesEvent = { ...started, media: 'audio', audioOnlyReason: 'setting-off' };
    const notes = buildMeetingNotes({
      ...withRecording({ hasVideo: false }),
      events: [audio, ...EVENTS.slice(1)],
    });
    expect(notes.recording).toMatchObject({ media: 'audio', audioOnlyReason: 'setting-off' });
    const without = buildMeetingNotes({
      ...withRecording({ hasVideo: false, eventsProtocol: 0 }),
      events: [],
    });
    expect(without.recording).toMatchObject({
      media: 'audio',
      audioOnlyReason: null,
      startCause: null,
    });
  });
});

describe('buildMeetingNotes: the meeting, why the recording ended, what it continues', () => {
  it('says which file a split recording continues, and after how long', () => {
    const continued: StoredNotesEvent = { ...started, continuesRecordingId: 'rec-0', gapMs: 2500 };
    const notes = buildMeetingNotes({
      ...input({ previousFile: '/d/zen-recorder/2026-10-04_14-03_Weekly product sync(1).webm' }),
      events: [continued, ...EVENTS.slice(1)],
    });
    expect(notes.recording.continues).toEqual({
      recordingId: 'rec-0',
      file: '2026-10-04_14-03_Weekly product sync(1).webm',
      gapMs: 2500,
    });
  });

  it('takes the end reason from the stop when the recording holds none, else knows none', () => {
    expect(buildMeetingNotes(withRecording({ endReason: undefined })).recording.endReason).toBe(
      'command',
    );
    const unstopped = EVENTS.filter((event) => event.type !== 'recording-stopped');
    const notes = buildMeetingNotes({
      ...withRecording({ endReason: undefined }),
      events: unstopped,
    });
    expect(notes.recording.endReason).toBeNull();
  });

  it('names a meeting without an id or a title as best it can', () => {
    const notes = buildMeetingNotes(withRecording({ meetingId: ' ', title: '\u200e', url: null }));
    expect(notes.meeting).toMatchObject({ id: 'unknown', title: 'unknown', url: null });
    const titled = buildMeetingNotes(withRecording({ title: '' }));
    expect(titled.meeting.title).toBe('abc-defg-hij');
  });

  it('says it continues a previous file it cannot name', () => {
    const continued: StoredNotesEvent = { ...started, continuesRecordingId: 'rec-0' };
    const notes = buildMeetingNotes({ ...input(), events: [continued, ...EVENTS.slice(1)] });
    expect(notes.recording.continues).toEqual({ recordingId: 'rec-0', file: null, gapMs: null });
  });
});

describe('buildMeetingNotes: whether the timeline is complete, and the end', () => {
  it('counts events sent late, after the end, as there: complete', () => {
    const notes = buildMeetingNotes(withRecording({ eventCount: 5, eventsUnsent: 2 }));
    expect(notes.capture).toMatchObject({ events: 'complete', eventsMissingReason: null });
  });

  it('says events never arrived when a seq from the end count on is missing', () => {
    const notes = buildMeetingNotes(withRecording({ eventCount: 7, eventsUnsent: 2 }));
    expect(notes.capture).toMatchObject({
      events: 'incomplete',
      eventsMissingReason: 'events-unsent',
    });
  });

  it('says the page dropped events when the missing seqs are the ones it dropped', () => {
    const events = EVENTS.filter((event) => event.seq !== 2);
    const notes = buildMeetingNotes({ ...withRecording({ eventsDropped: 1 }), events });
    expect(notes.capture).toMatchObject({
      events: 'incomplete',
      eventsMissingReason: 'events-dropped',
    });
    // Where they went missing: between the last event before the gap and the first after it.
    expect(notes.capture.coverage).toContainEqual({
      signal: 'all',
      reason: 'events-dropped',
      fromMs: 0,
      toMs: 119_990,
      fromAt: '2026-10-04T14:03:05+02:00',
      toAt: '2026-10-04T14:05:05+02:00',
    });
  });

  it('says the counts do not match when events are missing for no reason the page gave', () => {
    const events = EVENTS.filter((event) => event.seq !== 2);
    const notes = buildMeetingNotes({ ...input(), events });
    expect(notes.capture).toMatchObject({
      events: 'incomplete',
      eventsMissingReason: 'count-mismatch',
    });
  });

  it('ends a recording recovered 20 h later at its last chunk, and says the end is estimated', () => {
    const events = EVENTS.filter((event) => event.type !== 'recording-stopped');
    const notes = buildMeetingNotes({
      ...withRecording({ recovered: true, lastChunkAt: at(610), endReason: 'recovered' }),
      events,
    });
    expect(notes.recording).toMatchObject({
      end: '2026-10-04T14:13:15+02:00',
      endEstimated: true,
      recovered: true,
      endReason: 'recovered',
    });
    expect(notes.capture).toMatchObject({ events: 'incomplete', eventsMissingReason: 'recovered' });
    // The background adds the end of the file to the timeline, after the page's last event.
    expect(notes.events.at(-1)).toEqual({
      seq: 6,
      type: 'recording-stopped',
      at: '2026-10-04T14:13:15+02:00',
      mediaMs: 540_000,
      source: 'background',
      reason: 'recovered',
    });
  });

  it('says a page session older than the notes sent no events at all', () => {
    const notes = buildMeetingNotes({ ...withRecording({ eventsProtocol: 0 }), events: [] });
    expect(notes.capture).toMatchObject({
      events: 'none',
      eventsMissingReason: 'page-session-too-old',
      participantSource: 'none',
      signals: { participants: 'not-available', mic: 'not-available' },
    });
    expect(notes.recording).toMatchObject({ end: '2026-10-04T14:13:04+02:00', endEstimated: true });
  });

  it('says notes were off while the page recorded', () => {
    const notes = buildMeetingNotes({ ...input({ notesOffWhileRecording: true }), events: [] });
    expect(notes.capture).toMatchObject({
      events: 'none',
      eventsMissingReason: 'notes-off-during-recording',
    });
  });

  it('adds no end row to a recovered recording without events', () => {
    const notes = buildMeetingNotes({ ...withRecording({ recovered: true }), events: [] });
    expect(notes.events).toEqual([]);
  });
});

describe('buildMeetingNotes: participants, names and coverage', () => {
  it('names each participant once, with where they are in the file', () => {
    expect(buildMeetingNotes(input()).participants).toEqual([
      {
        id: 'p1',
        name: 'Jo Rocha',
        names: ['Jo Rocha'],
        self: true,
        identity: 'display-name',
        presentAtStart: true,
        presentAtEnd: true,
        spans: [{ joinedMs: null, leftMs: null }],
      },
      {
        id: 'p2',
        name: 'Ana Souza',
        names: ['Ana Souza'],
        self: false,
        identity: 'display-name',
        presentAtStart: true,
        presentAtEnd: true,
        spans: [{ joinedMs: null, leftMs: null }],
      },
      {
        id: 'p3',
        name: 'Ben Carter',
        names: ['Ben Carter'],
        self: false,
        identity: 'service-id',
        presentAtStart: false,
        presentAtEnd: true,
        spans: [{ joinedMs: 59_990, leftMs: null }],
      },
    ]);
  });

  it('turns a pause into a paused coverage span, with the wall times it lasted', () => {
    expect(buildMeetingNotes(input()).capture.coverage).toEqual([
      {
        signal: 'all',
        reason: 'paused',
        fromMs: 119_990,
        toMs: 119_990,
        fromAt: '2026-10-04T14:05:05+02:00',
        toAt: '2026-10-04T14:06:05+02:00',
      },
    ]);
  });

  it('keeps no name without names, but every id, the user and the title', () => {
    const notes = buildMeetingNotes(input({ notes: 'withoutNames' }));
    expect(notes.capture.names).toBe(false);
    expect(
      notes.participants.map(({ id, name, names, self }) => ({ id, name, names, self })),
    ).toEqual([
      { id: 'p1', name: null, names: [], self: true },
      { id: 'p2', name: null, names: [], self: false },
      { id: 'p3', name: null, names: [], self: false },
    ]);
    expect(notes.meeting.title).toBe('Weekly product sync');
    expect(JSON.stringify(notes)).not.toMatch(/Jo Rocha|Ana Souza|Ben Carter/);
  });
});
