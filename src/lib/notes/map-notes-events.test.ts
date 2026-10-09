import { describe, expect, it } from 'vitest';
import { mapNotesEvents, type NotesClock, type StoredNotesEvent } from './map-notes-events';

/** 2026-10-04 12:00:00 UTC: 14:00:00 in Berlin. */
const T0 = Date.UTC(2026, 9, 4, 12, 0, 0);
const clock: NotesClock = {
  timeZone: 'Europe/Berlin',
  mediaOffsetMs: 5,
  durationMs: 60_000,
  names: true,
};
const stamp = (seq: number) => ({ seq, atMs: T0 + seq * 1000, mediaMs: seq * 1000 + 5 });
const ana = { id: 'p2', name: 'Ana Souza', self: false } as const;

/** One stored event of every type. */
const STORED: StoredNotesEvent[] = [
  {
    ...stamp(0),
    type: 'recording-started',
    cause: 'manual',
    media: 'audio',
    audioOnlyReason: 'setting-off',
    continuesRecordingId: 'rec-0',
    gapMs: 1200,
    mic: 'muted',
    tabVisible: false,
    ownShare: true,
  },
  {
    ...stamp(1),
    type: 'roster',
    why: 'start',
    source: 'stage',
    participants: [{ id: 'p1', name: 'Jo', self: true }, ana],
    count: 2,
    share: 'active',
    shareBy: ana,
    stale: true,
    readAtMs: T0 - 2000,
    capabilities: { count: true, roster: false, self: true, share: true, shareBy: true },
  },
  { ...stamp(2), type: 'participant-joined', participant: null, count: 3 },
  { ...stamp(3), type: 'participant-left', participant: ana, count: 2 },
  { ...stamp(4), type: 'participant-renamed', participant: ana, from: 'Ana‮' },
  { ...stamp(5), type: 'participant-count', count: 4 },
  { ...stamp(6), type: 'share-started', by: null },
  { ...stamp(7), type: 'share-stopped', by: ana },
  { ...stamp(8), type: 'mic', state: 'live' },
  { ...stamp(9), type: 'connection-lost' },
  { ...stamp(10), type: 'connection-restored', lostMs: 900 },
  { ...stamp(11), type: 'video-failed' },
  { ...stamp(12), type: 'title-changed', title: '  Weekly\tsync  ' },
  { ...stamp(13), type: 'extension-reloaded' },
  { ...stamp(14), type: 'coverage-lost', signal: 'participants', reason: 'tab-hidden' },
  { ...stamp(15), type: 'coverage-restored', signal: 'participants', reason: 'tab-hidden' },
  { ...stamp(16), type: 'recording-paused' },
  { ...stamp(17), type: 'recording-resumed', pausedMs: 3000, paused: true },
  { ...stamp(18), type: 'recording-stopped', reason: 'command' },
];

const at = (seconds: number) => `2026-10-04T14:00:${String(seconds).padStart(2, '0')}+02:00`;

describe('mapNotesEvents', () => {
  it('writes every type with its fields: ids for participants, ISO times, positions in the file', () => {
    const mapped = mapNotesEvents(STORED, clock);
    expect(mapped.map((event) => event.type)).toEqual(STORED.map((event) => event.type));
    expect(mapped[0]).toEqual({
      seq: 0,
      type: 'recording-started',
      at: at(0),
      mediaMs: 0,
      source: 'page',
      cause: 'manual',
      media: 'audio',
      audioOnlyReason: 'setting-off',
      continuesRecordingId: 'rec-0',
      gapMs: 1200,
      mic: 'muted',
      tabVisible: false,
      ownShare: true,
    });
    expect(mapped[1]).toEqual({
      seq: 1,
      type: 'roster',
      at: at(1),
      mediaMs: 1000,
      source: 'page',
      why: 'start',
      participantSource: 'stage',
      present: ['p1', 'p2'],
      count: 2,
      share: 'active',
      shareBy: 'p2',
      stale: true,
      readAt: '2026-10-04T13:59:58+02:00',
      capabilities: { count: true, roster: false, self: true, share: true, shareBy: true },
    });
    expect(mapped.slice(2, 8)).toMatchObject([
      { participant: null, count: 3 },
      { participant: 'p2', count: 2 },
      { participant: 'p2', from: 'Ana' },
      { count: 4 },
      { by: null },
      { by: 'p2' },
    ]);
    expect(mapped.slice(8)).toMatchObject([
      { state: 'live' },
      { type: 'connection-lost' },
      { lostMs: 900 },
      { type: 'video-failed' },
      { title: 'Weekly sync' },
      { type: 'extension-reloaded' },
      { signal: 'participants', reason: 'tab-hidden' },
      { signal: 'participants', reason: 'tab-hidden' },
      { type: 'recording-paused' },
      { pausedMs: 3000, paused: true },
      { reason: 'command' },
    ]);
  });

  it('keeps no former name without names', () => {
    const mapped = mapNotesEvents(STORED, { ...clock, names: false });
    expect(mapped[4]).toMatchObject({ participant: 'p2', from: null });
  });

  it('keeps a rename without a former name', () => {
    const rename: StoredNotesEvent = {
      ...stamp(4),
      type: 'participant-renamed',
      participant: ana,
      from: null,
    };
    expect(mapNotesEvents([rename], clock)[0]).toMatchObject({ from: null });
  });

  it('writes the events in seq order, whatever order they were stored in', () => {
    const mapped = mapNotesEvents([...STORED].reverse(), clock);
    expect(mapped.map((event) => event.seq)).toEqual(STORED.map((event) => event.seq));
  });
});
