import { describe, expect, it } from 'vitest';
import { describeStartCause } from './describe-start-cause';

describe('describeStartCause', () => {
  it.each<[string | null, string]>([
    ['auto-first-remote', 'automatically once someone else was in the call'],
    ['auto-on-join', 'automatically when you joined the call'],
    ['manual', 'when you pressed Record'],
    ['restart-after-video-failure', 'automatically, after the video failed in the previous file'],
    [
      'restart-after-encoder-error',
      'automatically, after the recording failed in the previous file',
    ],
    [
      'restart-after-backlog-full',
      'automatically, after the previous file filled what the meeting page could hold',
    ],
    [
      'restart-after-video-back',
      'automatically, to record video again once Zen Recorder had caught up',
    ],
    [null, 'not known'],
    ['hand_raised', 'hand\\_raised'],
  ])('says %s started it', (cause, words) => {
    expect(describeStartCause(cause)).toBe(words);
  });
});
