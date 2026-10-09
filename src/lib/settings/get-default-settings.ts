import type { Settings } from '@/lib/types';

/** Factory defaults; returns a fresh object so callers can't mutate shared state. */
export function getDefaultSettings(): Settings {
  return {
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
  };
}
