import { describe, expect, it } from 'vitest';
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
