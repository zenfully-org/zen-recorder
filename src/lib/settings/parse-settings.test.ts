import { describe, expect, it } from 'vitest';
import { getDefaultSettings } from './get-default-settings';
import { parseSettings } from './parse-settings';

describe('parseSettings', () => {
  it.each([
    ['undefined', undefined],
    ['null', null],
    ['a string', 'nope'],
    ['an invalid field type', { autoRecord: 'yes' }],
    ['an out-of-range bitrate', { audioBitsPerSecond: 1 }],
    ['an unknown start rule', { startRule: 'always' }],
    ['an unknown video mode', { videoMode: 'screen' }],
    ['a fractional frame rate', { videoFps: 12.5 }],
    ['an unsupported video height', { videoHeight: 480 }],
    ['an out-of-range video bitrate', { videoBitsPerSecond: 10_000_000 }],
  ])('falls back to defaults for %s', (_label, input) => {
    expect(parseSettings(input)).toEqual(getDefaultSettings());
  });

  it('merges valid fields over the defaults and ignores unknown keys', () => {
    expect(parseSettings({ autoRecord: false, timesliceMs: 1000, extra: 1 })).toEqual({
      ...getDefaultSettings(),
      autoRecord: false,
      timesliceMs: 1000,
    });
  });

  it('accepts valid video settings', () => {
    expect(
      parseSettings({
        videoMode: 'off',
        videoFps: 5,
        videoHeight: 720,
        videoBitsPerSecond: 800_000,
      }),
    ).toEqual({
      ...getDefaultSettings(),
      videoMode: 'off',
      videoFps: 5,
      videoHeight: 720,
      videoBitsPerSecond: 800_000,
    });
  });

  it('keeps defaults for fields explicitly set to undefined', () => {
    expect(parseSettings({ overlayEnabled: undefined })).toEqual(getDefaultSettings());
  });

  it('trims the filename template', () => {
    expect(parseSettings({ filenameTemplate: '  {code} ' }).filenameTemplate).toBe('{code}');
  });
});
