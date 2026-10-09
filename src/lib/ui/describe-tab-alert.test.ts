import { describe, expect, it } from 'vitest';
import { describeTabAlert } from './describe-tab-alert';

describe('describeTabAlert', () => {
  it('says nothing while the tab records, or waits, as it should', () => {
    expect(describeTabAlert({})).toBeNull();
  });

  it('says the video stopped and the meeting records audio only', () => {
    expect(describeTabAlert({ backlogFull: 'audio-only' })).toMatchObject({
      kind: 'audio-only',
      label: 'Audio only',
      detail: expect.stringMatching(
        /^The video stopped: .* The rest of the meeting records audio only\./,
      ),
      toast: expect.stringMatching(/^Zen Recorder: the video stopped/),
    });
  });

  it('says nothing records until the page is taken what it holds', () => {
    expect(describeTabAlert({ backlogFull: 'waiting' })).toMatchObject({
      kind: 'waiting',
      label: 'Waiting for space',
      detail: expect.stringMatching(/^Nothing records: /),
      toast: expect.stringMatching(/^Zen Recorder: nothing records now/),
    });
  });

  it('says the recorder gave up on a broken encoder, and that Record tries again', () => {
    expect(describeTabAlert({ encoderGaveUp: true })).toMatchObject({
      kind: 'encoder-gave-up',
      label: 'Recording failed',
      detail: expect.stringMatching(/^Nothing records: .* Press Record to try again\.$/),
      toast: expect.stringMatching(/^Zen Recorder: .* Press Record to try again\.$/),
    });
  });

  // The person can do something about it now (press Record); a full backlog waits for the disk.
  it('says the encoder gave up over a full backlog', () => {
    const both = { encoderGaveUp: true, backlogFull: 'audio-only' } as const;
    expect(describeTabAlert(both)?.kind).toBe('encoder-gave-up');
  });
});
