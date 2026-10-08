import type { PageConfig } from '@/lib/types';

export type VideoCodecName = 'vp9' | 'vp8';

/** Result of probing the page's WebCodecs support once (null = no usable encoder). */
export interface VideoProbe {
  codec: VideoCodecName;
}

/** Everything the compositor and encoder need to start a video track. */
export interface VideoPlan {
  codec: VideoCodecName;
  width: number;
  height: number;
  fps: number;
  bitsPerSecond: number;
  labels: boolean;
}

/** 16:9 width rounded to an even number (encoders want even dimensions). */
function evenWidth(height: number): number {
  return 2 * Math.round((height * 8) / 9);
}

/**
 * Decides whether (and how) to record video for a recording: null means audio-only, either
 * because video is off or because no encoder is available (e.g. resistFingerprinting hides
 * WebCodecs).
 */
export function pickVideoPlan(input: {
  config: PageConfig;
  probe: VideoProbe | null;
}): VideoPlan | null {
  const { config, probe } = input;
  if (config.videoMode === 'off' || probe === null) return null;
  return {
    codec: probe.codec,
    width: evenWidth(config.videoHeight),
    height: config.videoHeight,
    fps: Math.min(30, Math.max(1, Math.round(config.videoFps))),
    bitsPerSecond: Math.min(8_000_000, Math.max(300_000, Math.round(config.videoBitsPerSecond))),
    labels: config.videoLabels,
  };
}
