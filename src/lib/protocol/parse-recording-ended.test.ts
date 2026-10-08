import { describe, expect, it } from 'vitest';
import { parseRecordingEnded } from './parse-recording-ended';

const valid = {
  recordingId: '4f3c6d2a-9d7c-4a4e-9f1e-0c1b2a3d4e5f',
  chunkCount: 6,
  durationMs: 18_000,
  reason: 'command',
};

describe('parseRecordingEnded', () => {
  it('accepts valid info', () => {
    expect(parseRecordingEnded(valid)).toEqual(valid);
  });

  it('accepts a recording stopped because the extension took none of its chunks for too long', () => {
    expect(parseRecordingEnded({ ...valid, reason: 'backlog-full' })).toEqual({
      ...valid,
      reason: 'backlog-full',
    });
  });

  it.each([
    ['an unknown reason', { ...valid, reason: 'meteor' }],
    ['a negative duration', { ...valid, durationMs: -5 }],
    ['undefined', undefined],
  ])('rejects %s', (_label, input) => {
    expect(parseRecordingEnded(input)).toBeNull();
  });
});
