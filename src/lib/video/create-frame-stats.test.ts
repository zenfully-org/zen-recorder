import { describe, expect, it } from 'vitest';
import { createFrameStats, type FrameTimings } from './create-frame-stats';

const timings = (overrides: Partial<FrameTimings> = {}): FrameTimings => ({
  find: 1,
  layout: 0.5,
  draw: 10,
  frame: 5,
  encode: 1.5,
  wait: 2,
  ...overrides,
});

describe('createFrameStats', () => {
  it('starts empty', () => {
    const stats = createFrameStats();
    expect(stats.snapshot()).toEqual({
      ticks: 0,
      busyTicks: 0,
      unchanged: 0,
      encoded: 0,
      sums: { find: 0, layout: 0, draw: 0, frame: 0, encode: 0, wait: 0 },
      p95: { find: 0, layout: 0, draw: 0, frame: 0, encode: 0, wait: 0, total: 0 },
    });
    expect(stats.recent(10_000, 5_000)).toEqual({
      encodedPerS: 0,
      busyPerS: 0,
      ticksPerS: 0,
      mainMsPerFrame: 0,
      mainMsPerS: 0,
      waitMsPerFrame: 0,
      p95MainMs: 0,
    });
  });

  it('counts ticks, busy ticks, unchanged frames and sums the time of encoded frames', () => {
    const stats = createFrameStats();
    stats.tick(0);
    stats.frame(0, timings());
    stats.tick(66);
    stats.unchanged(66);
    stats.busy(133);
    stats.tick(200);
    stats.frame(200, timings({ draw: 20 }));
    const snapshot = stats.snapshot();
    expect(snapshot).toMatchObject({ ticks: 3, busyTicks: 1, unchanged: 1, encoded: 2 });
    expect(snapshot.sums).toEqual({ find: 2, layout: 1, draw: 30, frame: 10, encode: 3, wait: 4 });
  });

  it('reports the 95th percentile of each phase and of the main-thread total over the last frames', () => {
    const stats = createFrameStats({ window: 20 });
    // 100 old slow frames fall out of the window; of the 20 kept, one is slow.
    for (let i = 0; i < 100; i++) stats.frame(i, timings({ draw: 100 }));
    for (let i = 0; i < 19; i++) stats.frame(100 + i, timings({ draw: i }));
    stats.frame(200, timings({ draw: 50, frame: 9 }));
    const { p95 } = stats.snapshot();
    expect(p95.draw).toBe(18);
    expect(p95.frame).toBe(5);
    // total = find + layout + draw + frame + encode (wait is not main-thread time)
    expect(p95.total).toBe(1 + 0.5 + 18 + 5 + 1.5);
  });

  it('describes the recent load over a time window', () => {
    const stats = createFrameStats();
    // An old period that is outside the window.
    for (let at = 0; at < 5_000; at += 100) {
      stats.tick(at);
      stats.frame(at, timings({ draw: 100 }));
    }
    // The last 5 s: 10 ticks per second, half of them encoded, two busy ticks per second.
    for (let at = 5_000; at < 10_000; at += 100) {
      stats.tick(at);
      if (at % 200 === 0) stats.frame(at, timings());
      else stats.unchanged(at);
      if (at % 500 === 0) stats.busy(at + 50);
    }
    const recent = stats.recent(10_000, 5_000);
    expect(recent.encodedPerS).toBe(5);
    expect(recent.ticksPerS).toBe(10);
    expect(recent.busyPerS).toBe(2);
    expect(recent.mainMsPerFrame).toBeCloseTo(18);
    expect(recent.mainMsPerS).toBeCloseTo(90);
    expect(recent.waitMsPerFrame).toBeCloseTo(2);
    // The old slow frames (draw 100 ms) are outside the window, so they do not count.
    expect(recent.p95MainMs).toBeCloseTo(18);
  });

  it('keeps a bounded history however long the recording', () => {
    const stats = createFrameStats({ window: 10, retainMs: 1_000 });
    for (let at = 0; at < 100_000; at += 10) {
      stats.tick(at);
      stats.busy(at);
      stats.frame(at, timings());
    }
    expect(stats.retained()).toBeLessThanOrEqual(3 * 101 + 10);
    expect(stats.recent(100_000, 1_000).encodedPerS).toBe(100);
  });
});
