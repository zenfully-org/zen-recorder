import { describe, expect, it } from 'vitest';
import { createConnectionEvents } from './create-connection-events';

/** What the tracker remembers of a moment: here, only when it was. */
const at = (atMs: number) => () => ({ atMs, mediaMs: atMs - 100 });

/** Feeds `observations` ([atMs, connected]) after a start `connected` or not; what they told. */
function run(observations: [number, boolean][], connected = true) {
  const events = createConnectionEvents(connected);
  return observations.flatMap(([atMs, up]) =>
    events.observe(up, atMs, at(atMs)).map((told) => ({ atMs, ...told })),
  );
}

describe('createConnectionEvents', () => {
  it('writes nothing for a loss shorter than 2 s', () => {
    expect(
      run([
        [1_000, false],
        [2_000, false],
        [2_900, true],
        [4_000, true],
      ]),
    ).toEqual([]);
  });

  it('writes a loss of 3 s as lost, stamped when it went, and restored with its length', () => {
    expect(
      run([
        [1_000, false],
        [2_000, false],
        [3_000, false],
        [4_000, true],
      ]),
    ).toEqual([
      { atMs: 3_000, stamp: { atMs: 1_000, mediaMs: 900 }, body: { type: 'connection-lost' } },
      {
        atMs: 4_000,
        stamp: { atMs: 4_000, mediaMs: 3_900 },
        body: { type: 'connection-restored', lostMs: 3_000 },
      },
    ]);
  });

  // The page observes when it runs: a loss can be seen only as it ends.
  it('writes a loss of 2 s or more seen only as it ended as lost, then restored, at once', () => {
    expect(
      run([
        [1_000, false],
        [3_500, true],
      ]),
    ).toEqual([
      { atMs: 3_500, stamp: { atMs: 1_000, mediaMs: 900 }, body: { type: 'connection-lost' } },
      {
        atMs: 3_500,
        stamp: { atMs: 3_500, mediaMs: 3_400 },
        body: { type: 'connection-restored', lostMs: 2_500 },
      },
    ]);
  });

  // The loss that ends the recording: the stop follows it, and nothing restores it.
  it('writes a loss that never ends as lost alone', () => {
    expect(
      run([
        [500, false],
        [3_000, false],
        [5_500, false],
      ]).map((e) => e.body),
    ).toEqual([{ type: 'connection-lost' }]);
  });

  // A recording started by hand before the call connected never lost a connection.
  it('takes the connection at the start as given: a call that connects later is no restore', () => {
    expect(
      run(
        [
          [3_000, false],
          [4_000, true],
          [5_000, false],
          [7_000, false],
        ],
        false,
      ),
    ).toEqual([
      { atMs: 7_000, stamp: { atMs: 5_000, mediaMs: 4_900 }, body: { type: 'connection-lost' } },
    ]);
  });

  // Nothing is observed after the stop: a loss that held 2 s until then is written.
  it('writes at the stop a loss that held 2 s by then, as of when it went', () => {
    const events = createConnectionEvents(true);
    expect(events.atStop(9_000)).toEqual([]);
    events.observe(false, 500, at(500));
    expect(events.atStop(2_499)).toEqual([]);
    expect(events.atStop(2_500)).toEqual([
      { stamp: { atMs: 500, mediaMs: 400 }, body: { type: 'connection-lost' } },
    ]);
  });
});
