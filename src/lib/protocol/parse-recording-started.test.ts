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
      tickMs: 1_000,
    });
  });

  it('defaults the provider an older page session does not send yet', () => {
    expect(parseRecordingStarted(valid)).toEqual({ ...valid, provider: 'meet', tickMs: 1_000 });
  });

  it('accepts the video flag', () => {
    expect(parseRecordingStarted({ ...valid, hasVideo: true })).toEqual({
      ...valid,
      provider: 'meet',
      hasVideo: true,
      tickMs: 1_000,
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

describe('parseRecordingStarted, the page tick', () => {
  // The notes say how late a change can be stamped: the page reads its sources once per tick.
  it('reads how often the page reads the meeting, and takes 1 s from a page that says none', () => {
    expect(parseRecordingStarted({ ...valid, tickMs: 500 })?.tickMs).toBe(500);
    expect(parseRecordingStarted(valid)?.tickMs).toBe(1_000);
    expect(parseRecordingStarted({ ...valid, tickMs: 0 })).toBeNull();
  });
});

describe('parseRecordingStarted, meeting events', () => {
  it('carries the events protocol the page speaks, and parses a page that says none', () => {
    expect(parseRecordingStarted({ ...valid, eventsProtocol: 1 })).toEqual({
      ...valid,
      provider: 'meet',
      eventsProtocol: 1,
      tickMs: 1_000,
    });
    expect(parseRecordingStarted(valid)).not.toHaveProperty('eventsProtocol');
  });
});
