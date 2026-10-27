/**
 * Writes a "video perf" line for a recording with video to the diagnostics log: the frames it
 * encoded against the rate it aimed for, and what its pipeline cost the page's main thread. The
 * first comes a minute into the recording, then one every ten minutes, read on every tick of the
 * page session, and one when it ends (`final`). Does nothing for a recording without video.
 */
import type { VideoRecorder } from '@/lib/page/create-video-recorder';
import { formatVideoPerf } from '@/lib/video/format-video-perf';

/** The first line comes this long into a recording, then one every interval. */
export const PERF_FIRST_MS = 60_000;
const PERF_EVERY_MS = 600_000;

interface PerfRecording {
  video: Pick<VideoRecorder, 'stats' | 'fps'> | null;
  /** When (performance clock) the recording started. */
  startedPerf: number;
  /** When (performance clock) the next line is due. */
  perfLogAt: number;
  /** The frame rate the settings asked for. */
  nominalFps: number;
}

export function reportVideoPerf(
  recording: PerfRecording | null,
  deps: { nowPerf: number; log: (level: 'info', message: string) => void; final?: true },
): void {
  const video = recording?.video;
  if (!recording || !video) return;
  if (!deps.final) {
    if (deps.nowPerf < recording.perfLogAt) return;
    recording.perfLogAt = deps.nowPerf + PERF_EVERY_MS;
  }
  const elapsedS = (deps.nowPerf - recording.startedPerf) / 1000;
  const perf = { stats: video.stats(), fps: video.fps(), nominalFps: recording.nominalFps };
  deps.log('info', formatVideoPerf({ ...perf, elapsedS }));
}
