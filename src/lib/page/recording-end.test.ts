import { describe, expect, it } from 'vitest';
import type { RecordingStartedInfo } from '@/lib/types';
import { recordingEnd } from './recording-end';

const started: RecordingStartedInfo = {
  recordingId: 'r1',
  provider: 'meet',
  meetingCode: 'abc-defg-hij',
  title: 'Standup',
  startedAt: 1,
  mimeType: 'audio/webm;codecs=opus',
  micLabel: null,
};

describe('recordingEnd', () => {
  it('counts the chunks handed out so far and rounds the time since the start', () => {
    expect(
      recordingEnd(
        { id: 'r1', chunkCount: 4, startedPerf: 1000.4, startedInfo: null },
        'pagehide',
        13_401,
      ),
    ).toEqual({
      recordingId: 'r1',
      chunkCount: 4,
      durationMs: 12_401,
      reason: 'pagehide',
    });
  });

  it('carries the announcement, which the background may never have received', () => {
    expect(
      recordingEnd(
        { id: 'r1', chunkCount: 1, startedPerf: 0, startedInfo: started },
        'command',
        900,
      ),
    ).toEqual({ recordingId: 'r1', chunkCount: 1, durationMs: 900, reason: 'command', started });
  });
});
