import { describe, expect, it } from 'vitest';
import { describeEndReason } from './describe-end-reason';

describe('describeEndReason', () => {
  it.each<[string | null, string]>([
    ['command', 'you pressed Stop'],
    ['left-meeting', 'you left the meeting'],
    ['pagehide', 'the meeting tab closed or went to another page'],
    [
      'connections-lost',
      'the call disconnected (you left, the meeting ended, or the network dropped)',
    ],
    ['encoder-error', 'the recording failed (an encoder error); it may go on in another file'],
    ['recovered', 'the meeting tab closed, or Firefox or the extension stopped, while recording'],
    [null, 'not known'],
    // A reason a newer version adds is written as it is, escaped.
    ['host_ended*', 'host\\_ended\\*'],
  ])('says why %s ended it', (reason, words) => {
    expect(describeEndReason(reason)).toBe(words);
  });
});
