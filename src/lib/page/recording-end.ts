import type { RecordingEndedInfo, RecordingStartedInfo, StopReason } from '@/lib/types';

/**
 * The end of a recording as of `nowPerf` (the performance clock it started on), with its
 * announcement once it has one: the background may never have received it. The file's length is
 * the encoder's clock, which stands still from the moment the encoder is stopped; the wall time
 * paused (`pausedMs`) is the part of the wall time the file does not hold.
 */
export function recordingEnd(
  recording: {
    id: string;
    chunkCount: number;
    startedPerf: number;
    startedInfo: RecordingStartedInfo | null;
    encoder: { mediaTimeMs(): number };
  },
  reason: StopReason,
  at: { nowPerf: number; pausedMs: number },
): RecordingEndedInfo {
  return {
    recordingId: recording.id,
    chunkCount: recording.chunkCount,
    durationMs: Math.round(at.nowPerf - recording.startedPerf),
    mediaDurationMs: Math.round(recording.encoder.mediaTimeMs()),
    pausedMs: at.pausedMs,
    reason,
    ...(recording.startedInfo ? { started: recording.startedInfo } : {}),
  };
}
