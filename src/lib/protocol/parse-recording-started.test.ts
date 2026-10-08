import { describe, expect, it } from 'vitest';
import { parseRecordingStarted } from './parse-recording-started';

const valid = {
  recordingId: '4f3c6d2a-9d7c-4a4e-9f1e-0c1b2a3d4e5f',
  meetingCode: 'abc-defg-hij',
  title: 'Standup',
  startedAt: 1,
  mimeType: 'audio/webm;codecs=opus',
  micLabel: 'Mic',
};

describe('parseRecordingStarted', () => {
  it('accepts valid info', () => {
    expect(parseRecordingStarted({ ...valid, provider: 'zoom' })).toEqual({
      ...valid,
      provider: 'zoom',
    });
  });

  it('defaults the provider an older page session does not send yet', () => {
    expect(parseRecordingStarted(valid)).toEqual({ ...valid, provider: 'meet' });
  });

  it('accepts the video flag', () => {
    expect(parseRecordingStarted({ ...valid, hasVideo: true })).toEqual({
      ...valid,
      provider: 'meet',
      hasVideo: true,
    });
  });

  it.each([
    ['a non-uuid id', { ...valid, recordingId: 'nope' }],
    ['an unknown provider', { ...valid, provider: 'webex' }],
    ['a missing mime type', { ...valid, mimeType: undefined }],
    ['null', null],
  ])('rejects %s', (_label, input) => {
    expect(parseRecordingStarted(input)).toBeNull();
  });
});
