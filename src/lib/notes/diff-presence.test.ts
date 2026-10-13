import { describe, expect, it } from 'vitest';
import type { ParticipantRef } from '@/lib/types';
import { diffPresence, type PresenceReading, type PresenceState } from './diff-presence';

type Stamp = { atMs: number };

const ref = (id: string, name: string | null, self: boolean | null = false): ParticipantRef => ({
  id,
  name,
  self,
  identity: 'service-id',
});
const JO = ref('p1', 'Jo', true);
const ANA = ref('p2', 'Ana');
const BEN = ref('p3', 'Ben');
const CHLOE = ref('p4', 'Chloé');
const DAN = ref('p5', 'Dan');

/** What the page shows on screen, with the page's count; no share it can tell. */
const stage = (count: number | null, ...people: ParticipantRef[]): PresenceReading => ({
  source: 'stage',
  participants: people,
  count,
  share: { kind: 'unknown' },
});
/** The page's list of everyone in the call. */
const roster = (...people: ParticipantRef[]): PresenceReading => ({
  source: 'roster',
  participants: people,
  count: people.length,
  share: { kind: 'unknown' },
});
/** `reading`, with `by` sharing a screen (null: nobody shares). */
const sharing = (reading: PresenceReading, by: ParticipantRef | null): PresenceReading => ({
  ...reading,
  share: by === null ? { kind: 'none' } : { kind: 'active', by },
});

/** One event as a row: when it is stamped, its type, and who or how many. */
function row({ stamp, body }: { stamp: Stamp; body: Parameters<typeof describeBody>[0] }): string {
  return `${stamp.atMs / 1000}s ${describeBody(body)}`;
}
function describeBody(body: ReturnType<typeof diffPresence<Stamp>>['events'][number]['body']) {
  switch (body.type) {
    case 'participant-joined':
    case 'participant-left':
      return `${body.type} ${body.participant?.name ?? 'someone'} (${body.count})`;
    case 'participant-renamed':
      return `${body.type} ${body.from} → ${body.participant.name}`;
    case 'participant-count':
      return `${body.type} ${body.count}`;
    case 'share-started':
    case 'share-stopped':
      return `${body.type} ${body.by?.name ?? 'someone'}`;
    case 'coverage-lost':
    case 'coverage-restored':
      return `${body.type} ${body.signal} ${body.reason}`;
  }
}

/** A reading and when the page took it, in ms from the start. */
type Timed = readonly [atMs: number, reading: PresenceReading | null];

/**
 * Feeds each reading at its own time and returns every event as a row; `final` ends the recording
 * after the last one.
 */
function runAt(readings: readonly Timed[], final = false): string[] {
  let state: PresenceState<Stamp> | null = null;
  const rows: string[] = [];
  readings.forEach(([atMs, reading], index) => {
    const last = index === readings.length - 1;
    const result = diffPresence(state, reading, { atMs }, final && last);
    state = result.state;
    rows.push(...result.events.map(row));
  });
  return rows;
}

/** Feeds the readings one second apart (the page's tick), from 0 s, as `runAt` does. */
const run = (readings: readonly (PresenceReading | null)[], final = false): string[] =>
  runAt(
    readings.map((reading, index) => [index * 1000, reading] as const),
    final,
  );

/** `reading` repeated `times` times. */
const hold = (reading: PresenceReading | null, times: number) =>
  Array.from({ length: times }, () => reading);

/** `reading` taken at each of `times`, in ms. */
const takenAt = (reading: PresenceReading, ...times: number[]): Timed[] =>
  times.map((atMs) => [atMs, reading] as const);

/** A case: what it shows, the readings one second apart, and the events they tell as rows. */
type Case = [string, (PresenceReading | null)[], string[]];

const BETWEEN_READINGS: Case[] = [
  [
    'the first reading is the baseline: present at the start, never joined',
    [stage(3, JO, ANA, BEN)],
    [],
  ],
  [
    'a roster: someone who appears joined',
    [roster(JO, ANA), roster(JO, ANA, CHLOE)],
    ['1s participant-joined Chloé (3)'],
  ],
  [
    'a roster: someone who vanishes left, written once gone 10 s, as of when they went',
    [roster(JO, ANA, BEN), ...hold(roster(JO, ANA), 11)],
    ['1s participant-left Ben (2)'],
  ],
  [
    'the stage: someone off screen while the count holds did not leave',
    [stage(3, JO, ANA, BEN), ...hold(stage(3, JO, ANA), 20)],
    [],
  ],
  [
    'the stage: a count drop with everyone on screen names who left',
    [stage(3, JO, ANA, BEN), ...hold(stage(2, JO, ANA), 11)],
    ['1s participant-left Ben (2)'],
  ],
  [
    // A paged gallery: Chloé joins off screen while Dan scrolls into view and Ben out of it.
    'a paging swap: the count goes up on a stage smaller than it, so only the count',
    [stage(5, JO, ANA, BEN), ...hold(stage(6, JO, ANA, DAN), 4)],
    ['1s participant-count 6'],
  ],
  [
    'the count first, the tile 2 s later: a named join, as of the count',
    [stage(2, JO, ANA), stage(3, JO, ANA), stage(3, JO, ANA), ...hold(stage(3, JO, ANA, CHLOE), 3)],
    ['1s participant-joined Chloé (3)'],
  ],
  [
    'the tile first, the count 2 s later: a named join, as of the tile',
    [
      stage(2, JO, ANA),
      stage(2, JO, ANA, CHLOE),
      stage(2, JO, ANA, CHLOE),
      ...hold(stage(3, JO, ANA, CHLOE), 3),
    ],
    ['1s participant-joined Chloé (3)'],
  ],
  [
    'two at once, both named',
    [stage(2, JO, ANA), stage(4, JO, ANA, CHLOE, DAN)],
    ['1s participant-joined Chloé (4)', '1s participant-joined Dan (4)'],
  ],
  [
    'the count alone, written once it held 3 s',
    [stage(2, JO, ANA), ...hold(stage(3, JO, ANA), 4)],
    ['1s participant-count 3'],
  ],
  [
    'a count that goes back within 3 s writes nothing',
    [stage(2, JO, ANA), stage(3, JO, ANA), stage(2, JO, ANA), ...hold(stage(2, JO, ANA), 4)],
    [],
  ],
  [
    'a join needs someone new: one already in the call scrolling into view is no join',
    // Dan was seen before (in the call, off screen since); the count goes up for someone else.
    [
      stage(3, JO, ANA, DAN),
      stage(3, JO, ANA),
      stage(4, JO, ANA, DAN),
      ...hold(stage(4, JO, ANA, DAN), 3),
    ],
    ['2s participant-count 4'],
  ],
  [
    // Ana left and two people came between two readings: the count went up by one only.
    'more newcomers than the count went up by: only the count',
    [stage(2, JO, ANA), ...hold(stage(3, JO, CHLOE, DAN), 4), ...hold(stage(2, JO, CHLOE), 12)],
    // Ana is not counted as still there, so Dan's leave can be named.
    ['1s participant-count 3', '5s participant-left Dan (2)'],
  ],
  [
    'without a count, nothing but renames',
    [
      stage(null, JO, ANA),
      stage(null, JO, ANA, CHLOE),
      stage(null, JO),
      ...hold(stage(null, JO), 12),
    ],
    [],
  ],
  [
    'a rename on a key that survives it',
    [stage(2, JO, ANA), stage(2, JO, ref('p2', 'Ana Souza'))],
    ['1s participant-renamed Ana → Ana Souza'],
  ],
  [
    'a person the page shows twice is one person on the stage',
    [stage(2, JO, ANA), stage(3, JO, ANA, CHLOE, CHLOE)],
    ['1s participant-joined Chloé (3)'],
  ],
  [
    'a leave and a return within 10 s write nothing: a reconnect',
    [
      stage(3, JO, ANA, BEN),
      stage(2, JO, ANA),
      stage(2, JO, ANA),
      stage(3, JO, ANA, BEN),
      ...hold(stage(3, JO, ANA, BEN), 12),
    ],
    [],
  ],
  [
    'a leave and a return 11 s later are a leave and a join',
    [stage(3, JO, ANA, BEN), ...hold(stage(2, JO, ANA), 11), stage(3, JO, ANA, BEN)],
    ['1s participant-left Ben (2)', '12s participant-joined Ben (3)'],
  ],
  [
    // No reading came between his tenth second away and his return: the return itself judges it.
    'gone at ten readings and back at the eleventh: a leave and a join',
    [stage(3, JO, ANA, BEN), ...hold(stage(2, JO, ANA), 10), ...hold(stage(3, JO, ANA, BEN), 3)],
    ['1s participant-left Ben (2)', '11s participant-joined Ben (3)'],
  ],
  [
    'a roster: gone at ten readings and back at the eleventh, a leave and a join',
    [roster(JO, ANA, BEN), ...hold(roster(JO, ANA), 10), ...hold(roster(JO, ANA, BEN), 3)],
    ['1s participant-left Ben (2)', '11s participant-joined Ben (3)'],
  ],
  [
    'gone at nine readings and back at the tenth: a reconnect, neither',
    [stage(3, JO, ANA, BEN), ...hold(stage(2, JO, ANA), 9), ...hold(stage(3, JO, ANA, BEN), 4)],
    [],
  ],
  [
    // His tile is back after 9 s; the count follows 2 s later, after his tenth second away.
    'back on the stage within 10 s, the count following past his tenth second: neither',
    [
      stage(3, JO, ANA, BEN),
      ...hold(stage(2, JO, ANA), 9),
      ...hold(stage(2, JO, ANA, BEN), 2),
      ...hold(stage(3, JO, ANA, BEN), 3),
    ],
    [],
  ],
  [
    'back on the stage after 10 s, the count 2 s later: a leave, and the join as of the tile',
    [
      stage(3, JO, ANA, BEN),
      ...hold(stage(2, JO, ANA), 10),
      ...hold(stage(2, JO, ANA, BEN), 2),
      ...hold(stage(3, JO, ANA, BEN), 3),
    ],
    ['1s participant-left Ben (2)', '11s participant-joined Ben (3)'],
  ],
  [
    // The count never agrees, so his return is told by nobody; how long he was away still counts.
    'back on the stage within 10 s, the count never following: neither',
    [stage(3, JO, ANA, BEN), ...hold(stage(2, JO, ANA), 9), ...hold(stage(2, JO, ANA, BEN), 5)],
    [],
  ],
  [
    'the user never joins or leaves',
    [roster(JO, ANA), roster(ANA), ...hold(roster(JO, ANA), 12)],
    [],
  ],
  [
    'no reading: the coverage is lost once, and what the page showed before holds',
    [stage(3, JO, ANA, BEN), null, null, stage(3, JO, ANA, BEN)],
    [
      '1s coverage-lost participants presence-unavailable',
      '3s coverage-restored participants presence-unavailable',
    ],
  ],
  [
    'a leave hidden by no reading is stamped at the return',
    [stage(3, JO, ANA, BEN), null, null, ...hold(stage(2, JO, ANA), 11)],
    [
      '1s coverage-lost participants presence-unavailable',
      '3s coverage-restored participants presence-unavailable',
      '3s participant-left Ben (2)',
    ],
  ],
  [
    'no reading at the start: the first one later is the baseline',
    [null, stage(2, JO, ANA), stage(2, JO, ANA)],
    [
      '0s coverage-lost participants presence-unavailable',
      '1s coverage-restored participants presence-unavailable',
    ],
  ],
];

const SHARES: Case[] = [
  [
    // A share is never a person: the sharer joins, then shares, and stays one participant.
    'someone joins and shares: a join, then a share',
    [sharing(stage(2, JO, ANA), null), sharing(stage(3, JO, ANA, CHLOE), CHLOE)],
    ['1s participant-joined Chloé (3)', '1s share-started Chloé'],
  ],
  [
    'no reading: neither people nor shares are observed until the call shows again',
    [sharing(stage(2, JO, ANA), ANA), null, sharing(stage(2, JO, ANA), null)],
    [
      '1s coverage-lost participants presence-unavailable',
      '1s coverage-lost share presence-unavailable',
      '2s coverage-restored participants presence-unavailable',
      '2s coverage-restored share presence-unavailable',
      '2s share-stopped Ana',
    ],
  ],
];

/** A case whose readings come when a busy page takes them, 1.3 to 1.8 s apart. */
type TimedCase = [string, Timed[], string[]];

const BUSY_PAGE: TimedCase[] = [
  [
    // The last reading without him is 9.7 s after the first: none came after his tenth second.
    'gone 11.5 s by the readings: a leave and a join',
    [
      [0, stage(3, JO, ANA, BEN)],
      ...takenAt(stage(2, JO, ANA), 1500, 3300, 4600, 6400, 7900, 9400, 11_200),
      [13_000, stage(3, JO, ANA, BEN)],
    ],
    ['1.5s participant-left Ben (2)', '13s participant-joined Ben (3)'],
  ],
  [
    'readings 1.8 s apart, gone 10.8 s by them: a leave and a join',
    [
      [0, stage(3, JO, ANA, BEN)],
      ...takenAt(stage(2, JO, ANA), 1800, 3600, 5400, 7200, 9000, 10_800),
      [12_600, stage(3, JO, ANA, BEN)],
    ],
    ['1.8s participant-left Ben (2)', '12.6s participant-joined Ben (3)'],
  ],
  [
    'a roster, gone 10.3 s by the readings: a leave and a join',
    [
      [0, roster(JO, ANA, BEN)],
      ...takenAt(roster(JO, ANA), 1300, 3000, 4500, 6200, 7600, 9400, 11_000),
      [11_600, roster(JO, ANA, BEN)],
    ],
    ['1.3s participant-left Ben (2)', '11.6s participant-joined Ben (3)'],
  ],
  [
    'back 9.9 s after the first reading without him: a reconnect, neither',
    [
      [0, stage(3, JO, ANA, BEN)],
      ...takenAt(stage(2, JO, ANA), 1500, 3200, 4900, 6300, 8100, 9600),
      ...takenAt(stage(3, JO, ANA, BEN), 11_400, 13_000, 14_600),
    ],
    [],
  ],
];

const AT_THE_END: Case[] = [
  [
    'back in the stop reading after 10 s away: a leave and a join',
    [stage(3, JO, ANA, BEN), ...hold(stage(2, JO, ANA), 10), stage(3, JO, ANA, BEN)],
    ['1s participant-left Ben (2)', '11s participant-joined Ben (3)'],
  ],
  [
    'back in the stop reading within 10 s: a reconnect, neither',
    [stage(3, JO, ANA, BEN), ...hold(stage(2, JO, ANA), 9), stage(3, JO, ANA, BEN)],
    [],
  ],
  [
    'a leave still held is written',
    [stage(3, JO, ANA, BEN), stage(2, JO, ANA)],
    ['1s participant-left Ben (2)'],
  ],
  [
    'a count still held is written',
    [stage(2, JO, ANA), stage(3, JO, ANA)],
    ['1s participant-count 3'],
  ],
  ['nothing more without a change', [stage(2, JO, ANA), stage(2, JO, ANA)], []],
  [
    // After a leave the page shows no call: the stop's reading says it, with the last one read.
    'no reading at the end: what was held is written all the same, and no coverage is lost',
    [stage(3, JO, ANA, BEN), stage(2, JO, ANA), null],
    ['1s participant-left Ben (2)'],
  ],
];

describe('diffPresence', () => {
  it.each(BETWEEN_READINGS)('%s', (_label, readings, rows) => {
    expect(run(readings)).toEqual(rows);
  });

  it.each(SHARES)('%s', (_label, readings, rows) => {
    expect(run(readings)).toEqual(rows);
  });

  it.each(AT_THE_END)('at the end of a recording, %s', (_label, readings, rows) => {
    expect(run(readings, true)).toEqual(rows);
  });

  it.each(BUSY_PAGE)('on a busy page, %s', (_label, readings, rows) => {
    expect(runAt(readings)).toEqual(rows);
  });

  it('writes a leave still open at a stop that came 10.5 s after it, on a busy page', () => {
    // The last reading before the stop is 9 s after the first one without him.
    const readings: Timed[] = [
      [0, stage(3, JO, ANA, BEN)],
      ...takenAt(stage(2, JO, ANA), 1500, 3300, 5100, 6900, 8700, 10_500, 12_000),
    ];
    expect(runAt(readings, true)).toEqual(['1.5s participant-left Ben (2)']);
  });

  it('names a returning person by the reading they came back in', () => {
    const renamed = ref('p3', 'Ben Carter');
    expect(
      run([stage(3, JO, ANA, BEN), stage(2, JO, ANA), stage(3, JO, ANA, renamed)], true),
    ).toEqual(['2s participant-renamed Ben → Ben Carter']);
    expect(
      run([stage(3, JO, ANA, BEN), ...hold(stage(2, JO, ANA), 11), stage(3, JO, ANA, renamed)]),
    ).toEqual(['1s participant-left Ben (2)', '12s participant-joined Ben Carter (3)']);
  });

  it('takes the count of someone the full stage shows gone without telling a leave', () => {
    // Ben left while the stage showed only part of the call: the count went down alone. Once the
    // whole call is on screen again, he is not counted as one of the people still there.
    const readings = [
      stage(4, JO, ANA, BEN),
      ...hold(stage(3, JO, ANA, BEN), 4),
      ...hold(stage(3, JO, ANA, CHLOE), 4),
      ...hold(stage(2, JO, ANA), 12),
    ];
    expect(run(readings)).toEqual(['1s participant-count 3', '9s participant-left Chloé (2)']);
  });

  it('leaves the state it was given as it was', () => {
    const first = diffPresence<Stamp>(null, stage(3, JO, ANA, BEN), { atMs: 0 });
    const before = JSON.stringify(first.state, (_key, value: unknown) =>
      value instanceof Map || value instanceof Set ? [...value] : value,
    );
    diffPresence(first.state, stage(2, JO, ANA), { atMs: 1000 });
    diffPresence(first.state, null, { atMs: 1000 });
    const after = JSON.stringify(first.state, (_key, value: unknown) =>
      value instanceof Map || value instanceof Set ? [...value] : value,
    );
    expect(after).toBe(before);
  });
});
