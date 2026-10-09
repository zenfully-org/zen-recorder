import { describe, expect, it } from 'vitest';
import { describeStartCause } from './describe-start-cause';

describe('describeStartCause', () => {
  it.each<[string | null, string, string]>([
    ['auto-first-remote', 'meet', "automatically when another participant's audio arrived"],
    ['auto-first-remote', 'zoom', 'automatically when another participant joined'],
    ['auto-on-join', 'teams', 'automatically when you joined the call'],
    ['manual', 'meet', 'when you pressed Record'],
    [
      'restart-after-video-failure',
      'meet',
      'automatically, after the video failed in the previous file',
    ],
    [null, 'meet', 'not known'],
    ['hand_raised', 'meet', 'hand\\_raised'],
  ])('says %s on %s started it', (cause, service, words) => {
    expect(describeStartCause(cause, service)).toBe(words);
  });
});
