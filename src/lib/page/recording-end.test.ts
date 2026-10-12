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

/** An encoder whose file is `ms` long. */
const at = (ms: number) => ({ mediaTimeMs: () => ms });

describe('recordingEnd', () => {
  it('counts the chunks handed out so far and rounds the time since the start', () => {
    expect(
      recordingEnd(
        { id: 'r1', chunkCount: 4, startedPerf: 1000.4, startedInfo: null, encoder: at(12_401) },
        'pagehide',
        { nowPerf: 13_401, pausedMs: 0 },
      ),
    ).toEqual({
      recordingId: 'r1',
      chunkCount: 4,
      durationMs: 12_401,
      mediaDurationMs: 12_401,
      pausedMs: 0,
      reason: 'pagehide',
    });
  });

  it('carries the announcement, which the background may never have received', () => {
    expect(
      recordingEnd(
        { id: 'r1', chunkCount: 1, startedPerf: 0, startedInfo: started, encoder: at(900) },
        'command',
        { nowPerf: 900, pausedMs: 0 },
      ),
    ).toEqual({
      recordingId: 'r1',
      chunkCount: 1,
      durationMs: 900,
      mediaDurationMs: 900,
      pausedMs: 0,
      reason: 'command',
      started,
    });
  });
});

describe('recordingEnd, where the file ends', () => {
  // The wall time counts the pauses; the file does not hold them.
  it("gives the file's length by the encoder's clock beside the wall time and the time paused", () => {
    expect(
      recordingEnd(
        { id: 'r1', chunkCount: 9, startedPerf: 0, startedInfo: null, encoder: at(20_400.4) },
        'command',
        { nowPerf: 30_000, pausedMs: 9_500 },
      ),
    ).toMatchObject({ durationMs: 30_000, mediaDurationMs: 20_400, pausedMs: 9_500 });
  });
});
