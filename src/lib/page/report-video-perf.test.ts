import { describe, expect, it } from 'vitest';
import { PERF_FIRST_MS, reportVideoPerf } from './report-video-perf';

const NO_TIME = { find: 0, layout: 0, draw: 0, frame: 0, encode: 0, wait: 0, frozen: 0 };

/** A recording with 15 fps of video that started at 0 and encoded 900 frames. */
function recording(video = true) {
  return {
    video: video
      ? {
          stats: () => ({
            ticks: 900,
            busyTicks: 0,
            unchanged: 0,
            encoded: 900,
            sums: NO_TIME,
            p95: { ...NO_TIME, total: 0 },
          }),
          fps: () => 15,
        }
      : null,
    startedPerf: 0,
    perfLogAt: PERF_FIRST_MS,
    nominalFps: 15,
  };
}

/** Reports `of` at each moment, and returns the lines it wrote. */
function linesAt(of: ReturnType<typeof recording> | null, moments: number[], final?: true) {
  const lines: string[] = [];
  const log = (level: string, message: string) => lines.push(`${level}: ${message}`);
  for (const nowPerf of moments) reportVideoPerf(of, { nowPerf, log, ...(final ? { final } : {}) });
  return lines;
}

describe('reportVideoPerf', () => {
  it('writes the first line a minute in, then one every ten minutes', () => {
    const lines = linesAt(recording(), [59_000, 60_000, 61_000, 659_000, 660_000]);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(
      /^info: video perf after 60 s: 15\.0 frames\/s encoded \(target 15\/15/,
    );
    expect(lines[1]).toMatch(/^info: video perf after 660 s: /);
  });

  it('writes one at the end of a recording, whenever it ends', () => {
    expect(linesAt(recording(), [5_000], true)).toEqual([
      expect.stringMatching(/^info: video perf after 5 s: /),
    ]);
  });

  it.each([
    ['a recording without video', recording(false)],
    ['no recording', null],
  ])('writes nothing for %s', (_label, of) => {
    expect(linesAt(of, [60_000])).toEqual([]);
    expect(linesAt(of, [60_000], true)).toEqual([]);
  });
});
