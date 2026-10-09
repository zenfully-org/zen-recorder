import { describe, expect, it } from 'vitest';
import { recordingEnd } from './recording-end';

describe('recordingEnd', () => {
  it('counts the chunks handed out so far and rounds the time since the start', () => {
    expect(
      recordingEnd({ id: 'r1', chunkCount: 4, startedPerf: 1000.4 }, 'pagehide', 13_401),
    ).toEqual({
      recordingId: 'r1',
      chunkCount: 4,
      durationMs: 12_401,
      reason: 'pagehide',
    });
  });
});
