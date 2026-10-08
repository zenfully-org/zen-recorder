import { describe, expect, it } from 'vitest';
import type { FrameStatsSnapshot } from './create-frame-stats';
import { formatVideoPerf } from './format-video-perf';

const snapshot = (overrides: Partial<FrameStatsSnapshot> = {}): FrameStatsSnapshot => ({
  ticks: 900,
  busyTicks: 30,
  unchanged: 60,
  encoded: 840,
  sums: { find: 336, layout: 8.4, draw: 15_120, frame: 7_140, encode: 252, wait: 840 },
  p95: { find: 0.6, layout: 0.02, draw: 24.5, frame: 11, encode: 0.5, wait: 4, total: 36.4 },
  ...overrides,
});

describe('formatVideoPerf', () => {
  it('summarizes rate, cost per step and main-thread share since the recording started', () => {
    expect(formatVideoPerf({ stats: snapshot(), fps: 10, nominalFps: 15, elapsedS: 60 })).toBe(
      'video perf after 60 s: 14.0 frames/s encoded (target 10/15 fps), ' +
        'main thread 27.2 ms/frame = 381 ms/s ' +
        '(find 0.4, layout 0.01, draw 18.0, frame 8.5, encode 0.3; p95 total 36.4), ' +
        'encoder wait 1.0 ms/frame, ticks skipped: 60 unchanged, 30 busy',
    );
  });

  it('copes with a recording that has not encoded anything yet', () => {
    const empty = snapshot({
      ticks: 0,
      busyTicks: 0,
      unchanged: 0,
      encoded: 0,
      sums: { find: 0, layout: 0, draw: 0, frame: 0, encode: 0, wait: 0 },
    });
    expect(formatVideoPerf({ stats: empty, fps: 15, nominalFps: 15, elapsedS: 0 })).toContain(
      'after 0 s: 0.0 frames/s encoded (target 15/15 fps), main thread 0.0 ms/frame = 0 ms/s',
    );
  });
});
