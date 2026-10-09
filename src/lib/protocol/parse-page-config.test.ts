import { describe, expect, it } from 'vitest';
import { getDefaultSettings } from '@/lib/settings/get-default-settings';
import type { PageConfig } from '@/lib/types';
import { parsePageConfig } from './parse-page-config';

const defaults: PageConfig = (() => {
  const d = getDefaultSettings();
  return {
    autoRecord: d.autoRecord,
    startRule: d.startRule,
    audioBitsPerSecond: d.audioBitsPerSecond,
    timesliceMs: d.timesliceMs,
    videoMode: d.videoMode,
    videoFps: d.videoFps,
    videoHeight: d.videoHeight,
    videoBitsPerSecond: d.videoBitsPerSecond,
    videoLabels: d.videoLabels,
    spoofVisibility: d.spoofVisibility,
    eventsProtocol: 0,
    bridgeId: '',
  };
})();

describe('parsePageConfig', () => {
  it.each([
    ['undefined', undefined],
    ['a string', 'x'],
    ['a wrong type', { autoRecord: 'yes' }],
    ['an out-of-range frame rate', { videoFps: 0 }],
    ['an unsupported height', { videoHeight: 1440 }],
  ])('returns the defaults for %s', (_label, input) => {
    expect(parsePageConfig(input)).toEqual(defaults);
  });

  it('merges valid fields over the defaults and ignores unknown keys', () => {
    expect(parsePageConfig({ videoMode: 'off', videoFps: 5, extra: true })).toEqual({
      ...defaults,
      videoMode: 'off',
      videoFps: 5,
    });
  });

  it('keeps defaults for fields explicitly set to undefined', () => {
    expect(parsePageConfig({ videoLabels: undefined })).toEqual(defaults);
  });
});

describe('parsePageConfig, meeting events', () => {
  // A bridge older than meeting events sends neither: the page then sends it none.
  it('defaults fields an older bridge does not send', () => {
    expect(parsePageConfig({ autoRecord: true })).toMatchObject({
      eventsProtocol: 0,
      bridgeId: '',
    });
  });

  it('reads the events protocol and the bridge id', () => {
    expect(parsePageConfig({ eventsProtocol: 1, bridgeId: 'b-7' })).toMatchObject({
      eventsProtocol: 1,
      bridgeId: 'b-7',
    });
  });
});
