import { describe, expect, it } from 'vitest';
import { parsePageConfig } from '@/lib/protocol/parse-page-config';
import { pickVideoPlan } from './pick-video-plan';

describe('pickVideoPlan', () => {
  it('returns null when video is off', () => {
    expect(
      pickVideoPlan({ config: parsePageConfig({ videoMode: 'off' }), probe: { codec: 'vp9' } }),
    ).toBeNull();
  });

  it('returns null when no encoder is available', () => {
    expect(pickVideoPlan({ config: parsePageConfig(undefined), probe: null })).toBeNull();
  });

  it('derives the plan from the config and the probed codec', () => {
    expect(pickVideoPlan({ config: parsePageConfig(undefined), probe: { codec: 'vp9' } })).toEqual({
      codec: 'vp9',
      width: 1920,
      height: 1080,
      fps: 15,
      bitsPerSecond: 2_500_000,
      labels: true,
    });
  });

  it.each([
    [360, 640],
    [540, 960],
    [720, 1280],
    [1080, 1920],
  ] as const)('maps height %d to an even 16:9 width %d', (videoHeight, width) => {
    const plan = pickVideoPlan({
      config: parsePageConfig({ videoHeight }),
      probe: { codec: 'vp8' },
    });
    expect(plan).toMatchObject({ width, height: videoHeight, codec: 'vp8' });
  });

  it('clamps out-of-range numbers defensively', () => {
    const config = { ...parsePageConfig(undefined), videoFps: 99.6, videoBitsPerSecond: 1 };
    expect(pickVideoPlan({ config, probe: { codec: 'vp9' } })).toMatchObject({
      fps: 30,
      bitsPerSecond: 300_000,
    });
  });
});
