import type { RecordingEndedInfo, RecordingStartedInfo, StopReason } from '@/lib/types';

/**
 * The end of a recording as of `nowPerf` (the performance clock it started on), with its
 * announcement once it has one: the background may never have received it. The file's length is
 * the encoder's clock, which stands still from the moment the encoder is stopped.
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
  nowPerf: number,
): RecordingEndedInfo {
  return {
    recordingId: recording.id,
    chunkCount: recording.chunkCount,
    durationMs: Math.round(nowPerf - recording.startedPerf),
    mediaDurationMs: Math.round(recording.encoder.mediaTimeMs()),
    reason,
    ...(recording.startedInfo ? { started: recording.startedInfo } : {}),
  };
}
