import { describe, expect, it } from 'vitest';
import { createAudioFileClock } from './create-audio-file-clock';

/** An audio graph's clock in seconds, moved by hand: it only moves when the test says so. */
function graphClock(start = 10) {
  let seconds = start;
  return {
    read: () => seconds,
    advance: (by: number) => {
      seconds += by;
    },
  };
}

type Step =
  | ['advance', number]
  | ['start']
  | ['pause']
  | ['resume']
  | ['stop']
  | ['expect', number];

/** Runs `steps` against a fresh clock; each `expect` reads `mediaTimeMs()`. */
function run(steps: Step[]): number[] {
  const graph = graphClock();
  const clock = createAudioFileClock(graph.read);
  const seen: number[] = [];
  for (const step of steps) {
    if (step[0] === 'advance') graph.advance(step[1]);
    else if (step[0] === 'start') clock.start();
    else if (step[0] === 'pause') clock.pause();
    else if (step[0] === 'resume') clock.resume();
    else if (step[0] === 'stop') clock.stop();
    else seen.push(clock.mediaTimeMs());
  }
  return seen;
}

describe('createAudioFileClock', () => {
  it.each<[string, Step[], number[]]>([
    [
      'before start',
      [
        ['advance', 5],
        ['expect', 0],
      ],
      [0],
    ],
    ['recording 1 s', [['start'], ['advance', 1], ['expect', 0]], [1000]],
    [
      'paused for 2 s',
      [['start'], ['advance', 1], ['pause'], ['advance', 2], ['expect', 0]],
      [1000],
    ],
    [
      'resumed then 1 s',
      [
        ['start'],
        ['advance', 1],
        ['pause'],
        ['advance', 2],
        ['resume'],
        ['advance', 1],
        ['expect', 0],
      ],
      [2000],
    ],
    [
      'two pauses',
      [
        ['start'],
        ['advance', 1],
        ['pause'],
        ['advance', 3],
        ['resume'],
        ['advance', 0.5],
        ['pause'],
        ['advance', 7],
        ['resume'],
        ['advance', 0.25],
        ['expect', 0],
      ],
      [1750],
    ],
    ['stopped', [['start'], ['advance', 2], ['stop'], ['advance', 4], ['expect', 0]], [2000]],
    [
      'stopped while paused',
      [['start'], ['advance', 2], ['pause'], ['advance', 1], ['stop'], ['expect', 0]],
      [2000],
    ],
  ])('%s', (_, steps, expected) => {
    expect(run(steps)).toEqual(expected);
  });

  // The graph's clock moves in render quanta; two calls inside one see no progress.
  it('gives the same value for two calls inside one render quantum', () => {
    expect(run([['start'], ['advance', 0.5], ['expect', 0], ['expect', 0]])).toEqual([500, 500]);
  });

  // It has no wall clock of its own: while the clock it reads stands still, so does it.
  it('stands still while the clock it reads does', () => {
    expect(
      run([['start'], ['advance', 1], ['expect', 0], ['expect', 0], ['advance', 1], ['expect', 0]]),
    ).toEqual([1000, 1000, 2000]);
  });

  it('counts nothing of a pause that began while the clock it reads stood still', () => {
    // The clock stands at 1 s, the recorder pauses, and resumes 2 s later by the wall clock.
    expect(
      run([['start'], ['advance', 1], ['pause'], ['resume'], ['advance', 1], ['expect', 0]]),
    ).toEqual([2000]);
  });

  it('never goes back, even when the graph clock does', () => {
    expect(
      run([['start'], ['advance', 2], ['expect', 0], ['advance', -0.5], ['expect', 0]]),
    ).toEqual([2000, 2000]);
  });

  it('ignores a pause or resume out of turn, and a second stop', () => {
    expect(
      run([
        ['resume'],
        ['start'],
        ['advance', 1],
        ['resume'],
        ['pause'],
        ['pause'],
        ['advance', 1],
        ['resume'],
        ['advance', 1],
        ['stop'],
        ['advance', 1],
        ['stop'],
        ['expect', 0],
      ]),
    ).toEqual([2000]);
  });
});
