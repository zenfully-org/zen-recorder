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

/** What the page shows on screen, with the page's count. */
const stage = (count: number | null, ...people: ParticipantRef[]): PresenceReading => ({
  source: 'stage',
  participants: people,
  count,
});
/** The page's list of everyone in the call. */
const roster = (...people: ParticipantRef[]): PresenceReading => ({
  source: 'roster',
  participants: people,
  count: people.length,
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
    case 'coverage-lost':
    case 'coverage-restored':
      return `${body.type} ${body.signal} ${body.reason}`;
  }
}

/**
 * Feeds the readings one second apart (the page's tick), from 0 s, and returns every event as a
 * row; `final` ends the recording after the last one.
 */
function run(readings: readonly (PresenceReading | null)[], final = false): string[] {
  let state: PresenceState<Stamp> | null = null;
  const rows: string[] = [];
  readings.forEach((reading, index) => {
    const last = index === readings.length - 1;
    const result = diffPresence(state, reading, { atMs: index * 1000 }, final && last);
    state = result.state;
    rows.push(...result.events.map(row));
  });
  return rows;
}

/** `reading` repeated `times` times. */
const hold = (reading: PresenceReading | null, times: number) =>
  Array.from({ length: times }, () => reading);

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

const AT_THE_END: Case[] = [
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

  it.each(AT_THE_END)('at the end of a recording, %s', (_label, readings, rows) => {
    expect(run(readings, true)).toEqual(rows);
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
