/**
 * The video packets of a saved recording on its own timeline: timestamps (s) and key flags. The
 * benchmark maps its phases (visible, hidden, …) onto this timeline to count the frames each one
 * really delivered, which also works for builds that report no statistics of their own.
 */
import { ALL_FORMATS, EncodedPacketSink, FilePathSource, Input } from 'mediabunny';

export interface VideoTimeline {
  durationS: number;
  bytes: number;
  frames: { t: number; key: boolean }[];
}

export async function readVideoTimeline(file: string, bytes: number): Promise<VideoTimeline> {
  const input = new Input({ source: new FilePathSource(file), formats: ALL_FORMATS });
  try {
    const durationS = await input.computeDuration();
    const track = await input.getPrimaryVideoTrack();
    const frames: VideoTimeline['frames'] = [];
    if (track) {
      const sink = new EncodedPacketSink(track);
      for await (const packet of sink.packets(undefined, undefined, { metadataOnly: true })) {
        frames.push({ t: packet.timestamp, key: packet.type === 'key' });
      }
    }
    return { durationS, bytes, frames };
  } finally {
    input.dispose();
  }
}

export interface WindowFrames {
  frames: number;
  fps: number;
  /** Longest gap between two consecutive frames in the window (s). */
  maxGapS: number;
  keyFrames: number;
}

/** Frames whose timestamp falls in [fromS, toS). */
export function framesInWindow(timeline: VideoTimeline, fromS: number, toS: number): WindowFrames {
  const inside = timeline.frames.filter((f) => f.t >= fromS && f.t < toS).map((f) => f.t);
  inside.sort((a, b) => a - b);
  let maxGapS = 0;
  for (let i = 1; i < inside.length; i++) {
    maxGapS = Math.max(maxGapS, (inside[i] ?? 0) - (inside[i - 1] ?? 0));
  }
  const keyFrames = timeline.frames.filter((f) => f.key && f.t >= fromS && f.t < toS).length;
  const span = Math.max(0.001, toS - fromS);
  return { frames: inside.length, fps: inside.length / span, maxGapS, keyFrames };
}
