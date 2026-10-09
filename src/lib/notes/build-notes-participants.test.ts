import { describe, expect, it } from 'vitest';
import type { NotesClock, StoredNotesEvent } from '@/lib/notes/map-notes-events';
import { buildNotesParticipants } from './build-notes-participants';

const clock: NotesClock = { timeZone: 'UTC', mediaOffsetMs: 0, durationMs: 100_000, names: true };
const stamp = (seq: number, mediaMs = seq * 1000) => ({ seq, atMs: seq * 1000, mediaMs });
const ref = (id: string, name: string | null, self: boolean | null = false) => ({ id, name, self });

const roster = (
  seq: number,
  why: 'start' | 'stop',
  people: ReturnType<typeof ref>[],
  shareBy: ReturnType<typeof ref> | null = null,
): StoredNotesEvent => ({
  ...stamp(seq),
  type: 'roster',
  why,
  source: 'stage',
  participants: people,
  count: people.length,
  share: shareBy === null ? 'none' : 'active',
  shareBy,
  stale: false,
  readAtMs: seq * 1000,
  capabilities: null,
});

describe('buildNotesParticipants', () => {
  it('follows someone who leaves, comes back and leaves again', () => {
    const ben = ref('p2', 'Ben');
    const events: StoredNotesEvent[] = [
      roster(0, 'start', [ref('p1', 'Jo', true), ben]),
      { ...stamp(1), type: 'participant-left', participant: ben, count: 1 },
      // A second leave without a return changes nothing.
      { ...stamp(2), type: 'participant-left', participant: ben, count: 1 },
      { ...stamp(3), type: 'participant-joined', participant: ben, count: 2 },
      // A join of someone already there changes nothing either.
      { ...stamp(4), type: 'participant-joined', participant: ben, count: 2 },
      { ...stamp(5), type: 'participant-left', participant: ben, count: 1 },
      roster(6, 'stop', [ref('p1', 'Jo', true)]),
    ];
    const [, second] = buildNotesParticipants(events, clock);
    expect(second).toMatchObject({
      id: 'p2',
      presentAtStart: true,
      presentAtEnd: false,
      spans: [
        { joinedMs: null, leftMs: 1000 },
        { joinedMs: 3000, leftMs: 5000 },
      ],
    });
  });

  it('starts the span of someone who leaves without being seen before at the file start', () => {
    const events: StoredNotesEvent[] = [
      { ...stamp(1), type: 'participant-left', participant: ref('p2', 'Ana'), count: 1 },
    ];
    expect(buildNotesParticipants(events, clock)[0]).toMatchObject({
      presentAtStart: null,
      presentAtEnd: null,
      spans: [{ joinedMs: null, leftMs: 1000 }],
    });
  });

  it('keeps every name in order, a rename adding the old one first', () => {
    const events: StoredNotesEvent[] = [
      {
        ...stamp(1),
        type: 'participant-renamed',
        participant: ref('p2', 'Benjamin Carter'),
        from: 'Ben',
      },
      {
        ...stamp(2),
        type: 'participant-renamed',
        participant: ref('p2', 'Ben'),
        from: 'Benjamin Carter',
      },
    ];
    expect(buildNotesParticipants(events, clock)[0]).toMatchObject({
      name: 'Ben',
      names: ['Ben', 'Benjamin Carter'],
    });
  });

  it('knows the sharer, the user, and how the page merged someone, from any reference', () => {
    const events: StoredNotesEvent[] = [
      { ...stamp(1), type: 'share-started', by: { id: 'p3', name: null, self: null } },
      {
        ...stamp(2),
        type: 'share-stopped',
        by: { ...ref('p3', 'Chloé', true), identity: 'service-id' },
      },
      { ...stamp(3), type: 'share-stopped', by: ref('p3', 'Chloé', false) },
      { ...stamp(4), type: 'participant-joined', participant: null, count: 3 },
      roster(5, 'stop', [], ref('p4', 'Dee')),
    ];
    expect(buildNotesParticipants(events, clock)).toEqual([
      {
        id: 'p3',
        name: 'Chloé',
        names: ['Chloé'],
        self: true,
        identity: 'service-id',
        presentAtStart: null,
        presentAtEnd: false,
        spans: [],
      },
      {
        id: 'p4',
        name: 'Dee',
        names: ['Dee'],
        self: false,
        identity: 'display-name',
        presentAtStart: null,
        presentAtEnd: false,
        spans: [],
      },
    ]);
  });

  it('keeps no name without names', () => {
    const events: StoredNotesEvent[] = [roster(0, 'start', [ref('p1', 'Jo', true)])];
    expect(buildNotesParticipants(events, { ...clock, names: false })[0]).toMatchObject({
      name: null,
      names: [],
      self: true,
    });
  });

  it('places spans in the file, past its start offset', () => {
    const events: StoredNotesEvent[] = [
      { ...stamp(1, 5_000), type: 'participant-joined', participant: ref('p2', 'Ana'), count: 2 },
    ];
    expect(buildNotesParticipants(events, { ...clock, mediaOffsetMs: 1_000 })[0]?.spans).toEqual([
      { joinedMs: 4_000, leftMs: null },
    ]);
  });
});
