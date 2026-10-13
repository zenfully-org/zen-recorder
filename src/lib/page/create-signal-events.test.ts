import { describe, expect, it } from 'vitest';
import type { MicState } from '@/lib/types';
import { createSignalEvents, type Seen } from './create-signal-events';

const START: Seen = {
  connected: true,
  mic: 'live',
  title: 'Weekly sync',
  visible: true,
  ownShare: null,
};

/** Feeds `changes` ([atMs, what changed]) from `start`, each held until the next; what they told. */
function run(changes: [number, Partial<Seen>][], start: Seen = START) {
  const signals = createSignalEvents<{ atMs: number }>(start);
  let seen = start;
  return changes.flatMap(([atMs, change]) => {
    seen = { ...seen, ...change };
    return signals
      .observe(seen, atMs, () => ({ atMs }))
      .map(({ stamp, body }) => ({ seenAt: stamp.atMs, toldAt: atMs, ...body }));
  });
}

describe('createSignalEvents, the microphone', () => {
  // Zoom shows "audio not joined" for about 3 s during its own reconnects.
  it('writes nothing for a state held under 4 s', () => {
    expect(
      run([
        [1_000, { mic: 'muted' }],
        [3_000, {}],
        [3_000, { mic: 'live' }],
        [9_000, {}],
      ]),
    ).toEqual([]);
  });

  it('writes a 5 s mute as muted then live, each stamped when it began', () => {
    expect(
      run([
        [1_000, { mic: 'muted' }],
        [5_000, {}],
        [6_000, { mic: 'live' }],
        [10_000, {}],
      ]),
    ).toEqual([
      { seenAt: 1_000, toldAt: 5_000, type: 'mic', state: 'muted' },
      { seenAt: 6_000, toldAt: 10_000, type: 'mic', state: 'live' },
    ]);
  });

  // The page observes when it runs: once a second, every 1.1 to 1.5 s on a busy page. Its
  // observations of a 5 s mute on such a page, from the first that saw it to the one that saw it end.
  it('writes a mute the page saw for over 4 s, though no observation came between its fourth second and its end', () => {
    expect(
      run([
        [1_000, { mic: 'muted' }],
        [2_075, {}],
        [3_466, {}],
        [4_941, {}],
        [6_017, { mic: 'live' }],
        [10_017, {}],
      ]),
    ).toEqual([
      { seenAt: 1_000, toldAt: 6_017, type: 'mic', state: 'muted' },
      { seenAt: 6_017, toldAt: 10_017, type: 'mic', state: 'live' },
    ]);
  });

  // A recording that starts muted says so in its start: only a change after it is an event.
  it('takes the state at the start as given', () => {
    const muted = { ...START, mic: 'muted' } as const;
    expect(
      run(
        [
          [5_000, {}],
          [6_000, { mic: 'not-connected' }],
          [10_000, {}],
        ],
        muted,
      ),
    ).toEqual([{ seenAt: 6_000, toldAt: 10_000, type: 'mic', state: 'not-connected' }]);
  });
});

/**
 * Feeds the page's microphone states ([atMs, what the page shows]) from `startState`, with the
 * recording's own state `live` throughout; what they told.
 */
function runPage(changes: [number, MicState | null][], startState: MicState | null = 'live') {
  const signals = createSignalEvents<{ atMs: number }>(START, startState);
  return changes.flatMap(([atMs, pageMic]) =>
    signals
      .observe(START, atMs, () => ({ atMs }), pageMic)
      .map(({ stamp, body }) => ({ seenAt: stamp.atMs, toldAt: atMs, ...body })),
  );
}

// Where the service shows the microphone (Zoom, Teams), its three states are the notes'.
describe('createSignalEvents, the microphone as the page shows it', () => {
  // Zoom shows "audio not joined" for about 3 s during its own reconnects.
  it('writes nothing for "not connected" held 3 s', () => {
    expect(
      runPage([
        [1_000, 'not-connected'],
        [3_000, 'not-connected'],
        [4_000, 'live'],
      ]),
    ).toEqual([]);
  });

  // Push-to-talk: muted, a second or two of talking, muted again.
  it('writes a 2 s mute as muted then live, each once it held 1 s', () => {
    expect(
      runPage([
        [1_000, 'muted'],
        [2_000, 'muted'],
        [3_000, 'live'],
        [4_000, 'live'],
      ]),
    ).toEqual([
      { seenAt: 1_000, toldAt: 2_000, type: 'mic', state: 'muted' },
      { seenAt: 3_000, toldAt: 4_000, type: 'mic', state: 'live' },
    ]);
  });

  it('writes "not connected" once it held 4 s', () => {
    expect(
      runPage([
        [1_000, 'not-connected'],
        [4_000, 'not-connected'],
        [5_000, 'not-connected'],
      ]),
    ).toEqual([{ seenAt: 1_000, toldAt: 5_000, type: 'mic', state: 'not-connected' }]);
  });

  it("starts from the page's state when it shows one", () => {
    expect(
      runPage(
        [
          [1_000, 'not-connected'],
          [6_000, 'not-connected'],
        ],
        'not-connected',
      ),
    ).toEqual([]);
  });

  it("keeps the recording's own state, held 4 s, where the page shows none", () => {
    expect(
      runPage(
        [
          [1_000, null],
          [6_000, null],
        ],
        null,
      ),
    ).toEqual([]);
    const signals = createSignalEvents<{ atMs: number }>(START, null);
    const muted = { ...START, mic: 'muted' } as const;
    signals.observe(muted, 1_000, () => ({ atMs: 1_000 }), null);
    expect(signals.observe(muted, 2_000, () => ({ atMs: 2_000 }), null)).toEqual([]);
    expect(signals.observe(muted, 5_000, () => ({ atMs: 5_000 }), null)).toHaveLength(1);
  });
});

describe('createSignalEvents, the title', () => {
  it.each<[string, [number, Partial<Seen>][]]>([
    [
      'held 3 s, then back',
      [
        [1_000, { title: 'Planning' }],
        [4_000, { title: 'Weekly sync' }],
        [9_000, {}],
      ],
    ],
    // The tab title of a page with unread messages: the meeting is the same.
    [
      'with an unread count before it',
      [
        [1_000, { title: '(3) Weekly sync' }],
        [9_000, {}],
      ],
    ],
    [
      'empty for a while (a page between two screens)',
      [
        [1_000, { title: '' }],
        [9_000, {}],
      ],
    ],
  ])('writes nothing for a title %s', (_label, changes) => {
    expect(run(changes)).toEqual([]);
  });

  it('writes a title that held 5 s, without its unread count, as of when it appeared', () => {
    expect(
      run([
        [1_000, { title: '(12) Planning' }],
        [6_000, {}],
        [6_000, { title: 'Planning' }],
      ]),
    ).toEqual([{ seenAt: 1_000, toldAt: 6_000, type: 'title-changed', title: 'Planning' }]);
  });
});

describe('createSignalEvents, the tab and the connection', () => {
  const hidden = { signal: 'participants', reason: 'tab-hidden' } as const;

  it('writes a tab hidden for 1 s as coverage lost from when it went, and restored at once', () => {
    expect(
      run([
        [1_000, { visible: false }],
        [2_000, {}],
        [4_000, { visible: true }],
      ]),
    ).toEqual([
      { seenAt: 1_000, toldAt: 2_000, type: 'coverage-lost', ...hidden },
      { seenAt: 4_000, toldAt: 4_000, type: 'coverage-restored', ...hidden },
    ]);
  });

  // Switching tabs can hide one for a few milliseconds: a page shows the same people after it.
  it('writes nothing for a tab hidden under 1 s', () => {
    expect(
      run([
        [1_000, { visible: false }],
        [1_012, { visible: true }],
        [3_000, {}],
      ]),
    ).toEqual([]);
  });

  it('says a tab hidden at the start is a span already open, and writes nothing it cannot tell', () => {
    expect(createSignalEvents({ ...START, visible: false }).atStart()).toEqual([
      { type: 'coverage-lost', ...hidden },
    ]);
    expect(createSignalEvents(START).atStart()).toEqual([]);
    // A page that stops being able to tell, and tells again: nothing it can say.
    expect(
      run([
        [1_000, { visible: null }],
        [2_000, { visible: true }],
      ]),
    ).toEqual([]);
  });

  it('writes a connection lost for 3 s as lost and restored', () => {
    expect(
      run([
        [1_000, { connected: false }],
        [3_000, {}],
        [4_000, { connected: true }],
      ]),
    ).toMatchObject([
      { seenAt: 1_000, type: 'connection-lost' },
      { seenAt: 4_000, type: 'connection-restored', lostMs: 3_000 },
    ]);
  });
});

// Nothing is observed after the stop: a state that held long enough until then is written.
describe('createSignalEvents, at the stop', () => {
  /** The connection lost, the microphone muted, a new title and the tab hidden, all at 1 s. */
  const changed: Seen = {
    connected: false,
    mic: 'muted',
    title: 'Planning',
    visible: false,
    ownShare: null,
  };

  it.each<[number, string[]]>([
    [1_900, []],
    [2_000, ['coverage-lost']],
    [3_000, ['connection-lost', 'coverage-lost']],
    [5_000, ['connection-lost', 'mic', 'coverage-lost']],
    [6_000, ['connection-lost', 'mic', 'title-changed', 'coverage-lost']],
  ])('writes, for a stop at %i ms, what held long enough by then: %j', (stopAt, types) => {
    const signals = createSignalEvents<{ atMs: number }>(START);
    signals.observe(changed, 1_000, () => ({ atMs: 1_000 }));
    const told = signals.atStop(stopAt);
    expect(told.map(({ body }) => body.type)).toEqual(types);
    // Each as of when it began.
    expect(told.every(({ stamp }) => stamp.atMs === 1_000)).toBe(true);
  });

  it('writes at the stop what it has already written, or what needs no hold, no more', () => {
    const signals = createSignalEvents<{ atMs: number }>(START);
    signals.observe(changed, 1_000, () => ({ atMs: 1_000 }));
    expect(signals.observe(changed, 7_000, () => ({ atMs: 7_000 }))).toHaveLength(4);
    signals.observe(START, 8_000, () => ({ atMs: 8_000 }));
    // Back on, the microphone holds 4 s and the title 5 s; connected and in front count at once.
    expect(signals.atStop(9_000)).toEqual([]);
    expect(signals.atStop(12_000)).toMatchObject([{ body: { type: 'mic', state: 'live' } }]);
    expect(signals.atStop(13_000)).toMatchObject([
      { stamp: { atMs: 8_000 }, body: { type: 'mic', state: 'live' } },
      { stamp: { atMs: 8_000 }, body: { type: 'title-changed', title: 'Weekly sync' } },
    ]);
  });
});
