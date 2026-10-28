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
      toolbar: expect.stringMatching(
        /^Zen Recorder: audio only\. The video stopped: a meeting tab .* The rest of the meeting records audio only\./,
      ),
    });
  });

  it('says nothing records until the page is taken what it holds', () => {
    expect(describeTabAlert({ backlogFull: 'waiting' })).toMatchObject({
      kind: 'waiting',
      label: 'Waiting for space',
      detail: expect.stringMatching(/^Nothing records: /),
      toast: expect.stringMatching(/^Zen Recorder: nothing records now/),
      toolbar: expect.stringMatching(
        /^Zen Recorder: waiting for space\. Nothing records: a meeting tab /,
      ),
    });
  });

  it('says the recorder gave up on a broken encoder, and that Record tries again', () => {
    expect(describeTabAlert({ encoderGaveUp: true })).toMatchObject({
      kind: 'encoder-gave-up',
      label: 'Recording failed',
      detail: expect.stringMatching(/^Nothing records: .* Press Record to try again\.$/),
      toast: expect.stringMatching(/^Zen Recorder: .* Press Record to try again\.$/),
      toolbar: expect.stringMatching(
        /^Zen Recorder: recording failed\. Nothing records: .* in a meeting tab, .* Press Record there to try again\.$/,
      ),
    });
  });

  it('says a call at an address it does not know records nothing, and to check for an update', () => {
    expect(describeTabAlert({ unknownAddress: true })).toMatchObject({
      kind: 'unknown-address',
      nothingRecords: true,
      label: 'Unknown address',
      detail: expect.stringMatching(/^Nothing records: this call's address is new to Zen Recorder/),
      toast: expect.stringMatching(
        /^Zen Recorder: nothing records in this call.* Check for an update\.$/,
      ),
      toolbar: expect.stringMatching(
        /^Zen Recorder: unknown address\. Nothing records: a meeting tab .* Check for an update\.$/,
      ),
    });
  });

  // The toolbar button belongs to the browser window, whichever tab is in front: "this tab" there
  // would point at the wrong one.
  it.each([
    ['audio-only', { backlogFull: 'audio-only' }],
    ['waiting', { backlogFull: 'waiting' }],
    ['encoder-gave-up', { encoderGaveUp: true }],
    ['unknown-address', { unknownAddress: true }],
  ] as const)('names no tab as "this tab" in the toolbar words (%s)', (_kind, fault) => {
    expect(describeTabAlert(fault)?.toolbar).not.toMatch(/this tab/i);
  });

  it('ranks the faults from the video that stopped to the address it does not know', () => {
    const severity = (fault: Parameters<typeof describeTabAlert>[0]) =>
      describeTabAlert(fault)?.severity;
    expect([
      severity({ backlogFull: 'audio-only' }),
      severity({ backlogFull: 'waiting' }),
      severity({ encoderGaveUp: true }),
      severity({ unknownAddress: true }),
    ]).toEqual([1, 2, 3, 4]);
  });

  // Nothing records in this call whatever the person does here: Record cannot, and neither can
  // the disk freeing up.
  it('says the address is unknown over every other fault', () => {
    const all = { unknownAddress: true, encoderGaveUp: true, backlogFull: 'waiting' } as const;
    expect(describeTabAlert(all)?.kind).toBe('unknown-address');
  });

  // The person can do something about it now (press Record); a full backlog waits for the disk.
  it('says the encoder gave up over a full backlog', () => {
    const both = { encoderGaveUp: true, backlogFull: 'audio-only' } as const;
    expect(describeTabAlert(both)?.kind).toBe('encoder-gave-up');
  });
});
