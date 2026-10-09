import type { RecordingEndedInfo, StopReason } from '@/lib/types';

/** The end of a recording as of `nowPerf` (the performance clock it started on). */
export function recordingEnd(
  recording: { id: string; chunkCount: number; startedPerf: number },
  reason: StopReason,
  nowPerf: number,
): RecordingEndedInfo {
  return {
    recordingId: recording.id,
    chunkCount: recording.chunkCount,
    durationMs: Math.round(nowPerf - recording.startedPerf),
    reason,
  };
}
