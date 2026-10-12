import type { AudioOnlyReason, VideoMode } from '@/lib/types';

/**
 * Why a recording has no video, for its notes: off in Options first, then what turned the video
 * off in this meeting (`videoOff`, from the video gate), else no plan for it, which means the
 * browser's encoder probe found none. Null with video.
 */
export function audioOnlyReasonOf(input: {
  hasVideo: boolean;
  videoMode: VideoMode;
  videoOff: Extract<AudioOnlyReason, 'pipeline-failed' | 'video-failed' | 'backlog-full'> | null;
}): AudioOnlyReason | null {
  if (input.hasVideo) return null;
  if (input.videoMode === 'off') return 'setting-off';
  return input.videoOff ?? 'no-encoder';
}
