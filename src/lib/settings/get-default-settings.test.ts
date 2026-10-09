import { describe, expect, it } from 'vitest';
import { getDefaultSettings } from './get-default-settings';

describe('getDefaultSettings', () => {
  it('returns sensible defaults', () => {
    expect(getDefaultSettings()).toEqual({
      autoRecord: true,
      startRule: 'firstRemote',
      audioBitsPerSecond: 64_000,
      timesliceMs: 3_000,
      filenameTemplate: '{date}_{time}_{title}',
      downloadSubfolder: 'zen-recorder',
      overlayEnabled: true,
      keepRawCopy: false,
      videoMode: 'tiles',
      videoFps: 15,
      videoHeight: 1080,
      videoBitsPerSecond: 2_500_000,
      videoLabels: true,
      spoofVisibility: false,
      meetingNotes: 'withNames',
    });
  });

  it('returns a new object every call', () => {
    const a = getDefaultSettings();
    const b = getDefaultSettings();
    a.autoRecord = false;
    expect(b.autoRecord).toBe(true);
  });
});
