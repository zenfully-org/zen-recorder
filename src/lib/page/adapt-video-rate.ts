/**
 * Adapts the composite frame rate of a recording with video to what the page's main thread and
 * the encoder can sustain, down when overloaded and back up when the load allows
 * (`decideVideoRate`). Runs on every tick of the page session; does nothing while the recording
 * has no video or its encoder is not recording.
 */
import type { VideoRecorder } from '@/lib/page/create-video-recorder';
import { decideVideoRate, RATE_WINDOW_MS } from '@/lib/video/decide-video-rate';

/** The adaptive frame rate never goes below this (see `decideVideoRate`). */
const MIN_VIDEO_FPS = 5;

interface RateRecording {
  video: Pick<VideoRecorder, 'fps' | 'setFps' | 'recentLoad'> | null;
  encoder: { state(): string };
  /** The rate the recording's plan asked for, which the rate never goes above. */
  nominalFps: number;
  rate: { changedAt: number; upgradeHoldMs: number };
}

export function adaptVideoRate(
  recording: RateRecording,
  deps: { nowPerf: number; log: (level: 'info' | 'warn', message: string) => void },
): void {
  const { video } = recording;
  if (!video || recording.encoder.state() !== 'recording') return;
  const fps = video.fps();
  const decision = decideVideoRate({
    fps,
    nominalFps: recording.nominalFps,
    minFps: MIN_VIDEO_FPS,
    load: video.recentLoad(RATE_WINDOW_MS),
    sinceChangeMs: deps.nowPerf - recording.rate.changedAt,
    upgradeHoldMs: recording.rate.upgradeHoldMs,
  });
  recording.rate.upgradeHoldMs = decision.upgradeHoldMs;
  const { next } = decision;
  if (!next) return;
  video.setFps(next.fps);
  recording.rate.changedAt = deps.nowPerf;
  const lowered = next.fps < fps;
  deps.log(
    lowered ? 'warn' : 'info',
    `video rate ${lowered ? 'lowered' : 'raised'} to ${next.fps} fps: ${next.reason}`,
  );
}
