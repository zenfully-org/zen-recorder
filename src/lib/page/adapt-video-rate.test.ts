import { describe, expect, it } from 'vitest';
import type { RecentLoad } from '@/lib/video/create-frame-stats';
import { adaptVideoRate } from './adapt-video-rate';

const load = (overrides: Partial<RecentLoad> = {}): RecentLoad => ({
  encodedPerS: 15,
  ticksPerS: 15,
  busyPerS: 0,
  mainMsPerFrame: 10,
  mainMsPerS: 150,
  waitMsPerFrame: 1,
  p95MainMs: 12,
  ...overrides,
});

/** A recording with video at `fps`, its rate last changed at 0 ms; `state` is the encoder's. */
function recording(fps: number, recent: RecentLoad, state = 'recording') {
  const video = {
    rate: fps,
    fps: () => video.rate,
    setFps: (next: number) => {
      video.rate = next;
    },
    recentLoad: () => recent,
  };
  return {
    video,
    encoder: { state: () => state },
    nominalFps: 15,
    rate: { changedAt: 0, upgradeHoldMs: 20_000 },
  };
}

describe('adaptVideoRate', () => {
  it('lowers the rate of an overloaded recording, says so as a warning, and holds the next raise longer', () => {
    const logs: string[] = [];
    const busy = recording(15, load({ mainMsPerFrame: 60, mainMsPerS: 900 }));
    adaptVideoRate(busy, {
      nowPerf: 60_000,
      log: (level, message) => logs.push(`${level}: ${message}`),
    });
    expect(busy.video.rate).toBeLessThan(15);
    expect(busy.rate).toEqual({ changedAt: 60_000, upgradeHoldMs: 40_000 });
    expect(logs).toEqual([expect.stringMatching(/^warn: video rate lowered to \d+(\.\d+)? fps: /)]);
  });

  it('raises the rate again once the load allows, as information', () => {
    const logs: string[] = [];
    const light = recording(5, load({ ticksPerS: 5, encodedPerS: 5 }));
    adaptVideoRate(light, {
      nowPerf: 60_000,
      log: (level, message) => logs.push(`${level}: ${message}`),
    });
    expect(light.video.rate).toBeGreaterThan(5);
    expect(logs).toEqual([expect.stringMatching(/^info: video rate raised to /)]);
  });

  it('leaves the rate alone under a light load, and a recording without video or not recording', () => {
    const logs: string[] = [];
    const log = (level: string, message: string) => logs.push(`${level}: ${message}`);
    const steady = recording(15, load());
    adaptVideoRate(steady, { nowPerf: 60_000, log });
    const paused = recording(15, load({ mainMsPerFrame: 60, mainMsPerS: 900 }), 'paused');
    adaptVideoRate(paused, { nowPerf: 60_000, log });
    adaptVideoRate({ ...steady, video: null }, { nowPerf: 60_000, log });
    expect([steady.video.rate, paused.video.rate]).toEqual([15, 15]);
    expect(logs).toEqual([]);
  });
});
