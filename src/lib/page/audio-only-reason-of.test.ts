import { describe, expect, it } from 'vitest';
import { audioOnlyReasonOf } from './audio-only-reason-of';

describe('audioOnlyReasonOf', () => {
  it.each([
    ['a recording with video', true, 'tiles', null, null],
    ['video off in Options', false, 'off', null, 'setting-off'],
    // The setting is the person's choice: it explains the file before anything else.
    ['video off in Options, after a failure', false, 'off', 'video-failed', 'setting-off'],
    ['the video failed earlier in the meeting', false, 'tiles', 'video-failed', 'video-failed'],
    ['the pipeline could not start', false, 'tiles', 'pipeline-failed', 'pipeline-failed'],
    ['video filled the backlog', false, 'tiles', 'backlog-full', 'backlog-full'],
    ['no video plan: the probe found no encoder', false, 'tiles', null, 'no-encoder'],
  ] as const)('%s → %s', (_label, hasVideo, videoMode, videoOff, reason) => {
    expect(audioOnlyReasonOf({ hasVideo, videoMode, videoOff })).toBe(reason);
  });
});
