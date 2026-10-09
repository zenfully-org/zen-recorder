import type { RecordingEndedInfo, RecordingStartedInfo, StopReason } from '@/lib/types';

/**
 * The end of a recording as of `nowPerf` (the performance clock it started on), with its
 * announcement once it has one: the background may never have received it.
 */
export function recordingEnd(
  recording: {
    id: string;
    chunkCount: number;
    startedPerf: number;
    startedInfo: RecordingStartedInfo | null;
  },
  reason: StopReason,
  nowPerf: number,
): RecordingEndedInfo {
  return {
    recordingId: recording.id,
    chunkCount: recording.chunkCount,
    durationMs: Math.round(nowPerf - recording.startedPerf),
    reason,
    ...(recording.startedInfo ? { started: recording.startedInfo } : {}),
  };
}
