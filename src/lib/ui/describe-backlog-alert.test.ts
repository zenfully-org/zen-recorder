import { describe, expect, it } from 'vitest';
import { describeBacklogAlert } from './describe-backlog-alert';

describe('describeBacklogAlert', () => {
  it('says nothing while the page holds less than its limit', () => {
    expect(describeBacklogAlert(undefined)).toBeNull();
  });

  it('says the video stopped and the meeting records audio only', () => {
    expect(describeBacklogAlert('audio-only')).toMatchObject({
      label: 'Audio only',
      detail: expect.stringMatching(
        /^The video stopped: .* The rest of the meeting records audio only\./,
      ),
      toast: expect.stringMatching(/^Zen Recorder: the video stopped/),
    });
  });

  it('says nothing records until the page is taken what it holds', () => {
    expect(describeBacklogAlert('waiting')).toMatchObject({
      label: 'Waiting for space',
      detail: expect.stringMatching(/^Nothing records: /),
      toast: expect.stringMatching(/^Zen Recorder: nothing records now/),
    });
  });
});
