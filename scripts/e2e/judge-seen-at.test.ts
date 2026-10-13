// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { type CanvasFreeze, judgeSeenAt } from './judge-seen-at';

interface Case {
  name: string;
  /** Where the notes place it, ms into the file; undefined when they do not say it. */
  actual: number | undefined;
  /** When the run made it happen, ms into the file. */
  at: number;
  tolerance: number;
  freezes: CanvasFreeze[];
  want: string[];
}

/** The freeze of the CI run that failed: 10 001 ms, as the recorder logged it. */
const CI_FREEZE = { from: 15_443, to: 25_444 };

describe('judgeSeenAt', () => {
  it.each<Case>([
    {
      name: 'the notes place it within the tolerance of when the run made it happen',
      ...{ actual: 18_900, at: 18_226, tolerance: 1_000, freezes: [] },
      want: [],
    },
    {
      name: 'the notes place it a little before, within the tolerance',
      ...{ actual: 17_300, at: 18_226, tolerance: 1_000, freezes: [] },
      want: [],
    },
    {
      name: 'the notes place it past the tolerance, and no freeze explains it',
      ...{ actual: 25_450, at: 18_226, tolerance: 1_000, freezes: [] },
      want: ['the tab shown at 25450 ms, not 18226 ms'],
    },
    {
      name: 'the notes do not say it',
      ...{ actual: undefined, at: 18_226, tolerance: 1_000, freezes: [] },
      want: ['the tab shown at undefined ms, not 18226 ms'],
    },
    {
      name: 'the page was frozen when the run showed the tab, and saw it as it ran again',
      ...{ actual: 25_450, at: 18_226, tolerance: 1_000, freezes: [CI_FREEZE] },
      want: [],
    },
    {
      name: 'the page was frozen when the run renamed the meeting, and read the title as it ran again',
      ...{ actual: 25_444, at: 18_239, tolerance: 1_500, freezes: [CI_FREEZE] },
      want: [],
    },
    {
      name: 'the page saw it as the run made it happen, though a freeze followed',
      ...{ actual: 18_300, at: 18_226, tolerance: 1_000, freezes: [{ from: 18_500, to: 28_500 }] },
      want: [],
    },
    {
      name: 'a freeze began before the page read it: read once the page ran again',
      ...{ actual: 28_510, at: 18_239, tolerance: 1_500, freezes: [{ from: 18_400, to: 28_501 }] },
      want: [],
    },
    {
      name: 'the page ran again, and the notes place it later still',
      ...{ actual: 27_000, at: 18_226, tolerance: 1_000, freezes: [CI_FREEZE] },
      want: [
        'the tab shown at 27000 ms, not between 17226 and 26444 ms (canvas snapshots froze the page 15443-25444 ms)',
      ],
    },
    {
      name: 'the page was frozen, and the notes do not say it',
      ...{ actual: undefined, at: 18_226, tolerance: 1_000, freezes: [CI_FREEZE] },
      want: [
        'the tab shown at undefined ms, not between 17226 and 26444 ms (canvas snapshots froze the page 15443-25444 ms)',
      ],
    },
    {
      name: 'the page was frozen, and the notes place it before the run made it happen',
      ...{ actual: 15_000, at: 18_226, tolerance: 1_000, freezes: [CI_FREEZE] },
      want: [
        'the tab shown at 15000 ms, not between 17226 and 26444 ms (canvas snapshots froze the page 15443-25444 ms)',
      ],
    },
    {
      name: 'a freeze that ended before the run made it happen explains nothing',
      ...{ actual: 25_450, at: 18_226, tolerance: 1_000, freezes: [{ from: 5_000, to: 15_000 }] },
      want: ['the tab shown at 25450 ms, not 18226 ms'],
    },
    {
      name: 'a freeze that began past the tolerance explains nothing',
      ...{ actual: 30_000, at: 18_226, tolerance: 1_000, freezes: [{ from: 19_300, to: 29_300 }] },
      want: ['the tab shown at 30000 ms, not 18226 ms'],
    },
    {
      name: 'a second freeze right after the first: the page ran again after both',
      ...{ actual: 35_800, at: 18_226, tolerance: 1_000 },
      freezes: [{ from: 25_900, to: 35_800 }, CI_FREEZE],
      want: [],
    },
  ])('$name', ({ actual, at, tolerance, freezes, want }) => {
    expect(judgeSeenAt({ label: 'the tab shown at', actual, at, tolerance, freezes })).toEqual(
      want,
    );
  });
});
