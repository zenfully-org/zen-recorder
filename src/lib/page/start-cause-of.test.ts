import { describe, expect, it } from 'vitest';
import { startCauseOf } from './start-cause-of';

describe('startCauseOf', () => {
  it.each([
    ['firstRemote', false, 'auto-first-remote'],
    ['onJoin', false, 'auto-on-join'],
    ['command', false, 'manual'],
    // The page treats any encoder error of a recording with video as its video failing.
    ['encoder-error', true, 'restart-after-video-failure'],
    ['encoder-error', false, 'restart-after-encoder-error'],
    ['backlog-full', true, 'restart-after-backlog-full'],
    ['video-back', false, 'restart-after-video-back'],
  ] as const)('%s (the stopped recording had video: %s) → %s', (trigger, hadVideo, cause) => {
    expect(startCauseOf(trigger, hadVideo)).toBe(cause);
  });
});
