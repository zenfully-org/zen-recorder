import { describe, expect, it } from 'vitest';
import { parseRecordingEnded } from './parse-recording-ended';

const valid = {
  recordingId: '4f3c6d2a-9d7c-4a4e-9f1e-0c1b2a3d4e5f',
  chunkCount: 6,
  durationMs: 18_000,
  reason: 'command',
};
const started = {
  recordingId: valid.recordingId,
  provider: 'zoom',
  meetingCode: '123456789',
  title: 'Standup',
  startedAt: 1,
  mimeType: 'video/webm;codecs=vp9,opus',
  micLabel: null,
  hasVideo: true,
  tickMs: 1_000,
};

describe('parseRecordingEnded', () => {
  it('accepts valid info', () => {
    expect(parseRecordingEnded(valid)).toEqual(valid);
  });

  it('accepts a recording stopped to record video again once the extension took its backlog', () => {
    expect(parseRecordingEnded({ ...valid, reason: 'video-back' })).toEqual({
      ...valid,
      reason: 'video-back',
    });
  });

  it('accepts a recording stopped because the extension took none of its chunks for too long', () => {
    expect(parseRecordingEnded({ ...valid, reason: 'backlog-full' })).toEqual({
      ...valid,
      reason: 'backlog-full',
    });
  });

  it("carries the recording's announcement, which can stand for a start that never arrived", () => {
    expect(parseRecordingEnded({ ...valid, started })).toEqual({ ...valid, started });
  });

  it.each([
    ['it cannot read', { recordingId: valid.recordingId, title: 7 }],
    ['of another recording', { ...started, recordingId: '7a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d' }],
  ])('keeps the end and drops an announcement %s', (_label, started) => {
    expect(parseRecordingEnded({ ...valid, started })).toEqual(valid);
  });

  it.each([
    ['an unknown reason', { ...valid, reason: 'meteor' }],
    ['a negative duration', { ...valid, durationMs: -5 }],
    ['undefined', undefined],
  ])('rejects %s', (_label, input) => {
    expect(parseRecordingEnded(input)).toBeNull();
  });
});

describe('parseRecordingEnded, where the file ends', () => {
  it("accepts the file's length by the encoder's clock", () => {
    expect(parseRecordingEnded({ ...valid, mediaDurationMs: 17_250 })).toEqual({
      ...valid,
      mediaDurationMs: 17_250,
    });
  });

  it.each([
    ['negative', -1],
    ['not a number', '17 s'],
  ])('keeps the end and drops a length that is %s', (_label, mediaDurationMs) => {
    expect(parseRecordingEnded({ ...valid, mediaDurationMs })).toEqual(valid);
  });
});

describe('parseRecordingEnded, the meeting events', () => {
  it('accepts how many events the page numbered, dropped and could not hand over', () => {
    const counts = { eventCount: 12, eventsDropped: 1, eventsUnsent: 2 };
    expect(parseRecordingEnded({ ...valid, ...counts })).toEqual({ ...valid, ...counts });
  });

  it('keeps the end and drops counts it cannot read', () => {
    expect(
      parseRecordingEnded({ ...valid, eventCount: -1, eventsDropped: 'x', eventsUnsent: 1.5 }),
    ).toEqual(valid);
  });
});
