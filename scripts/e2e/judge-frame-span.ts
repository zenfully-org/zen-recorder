/**
 * Judges whether one stretch of a recording (the tab in front, the tab hidden, …) holds the video
 * frames it should, in a way that tells a stalled tab apart from a busy machine.
 *
 * The recorder lowers its frame rate when compositing costs too much of the page's main thread or
 * when frames cannot keep up (down to 5 fps, `decideVideoRate`). So a span is held to the rate the
 * recorder aimed for over it, not to the configured 15 fps: at least 60 % of those frames must be
 * in the file (the rest allows for timer jitter and for where the span's ends fall).
 *
 * A span short of that is still not a fault when the recorder measured itself overloaded over it,
 * by the same thresholds that make it lower its rate: on a starved machine a page can go seconds
 * without a frame, before and after the rate went down. A hidden tab that stops producing frames
 * looks different: its tiles are not redrawn (frames only on the 1 s heartbeat) or its clock is
 * throttled or stopped, and the pipeline then costs less, not more.
 */
import { BUSY_RATIO_DOWN, OVERLOAD_MS_PER_S } from '../../src/lib/video/decide-video-rate';

/** The recorder's video statistics (`__zenRecorderPage.debug().video`) at one moment. */
export interface VideoStatsSample {
  /** When it was read (epoch ms). */
  at: number;
  /** The frame rate the recorder aimed for then. */
  fps: number;
  /** Clock ticks that ran, and those skipped because the previous frame was still in flight. */
  ticks: number;
  busyTicks: number;
  /** Main-thread milliseconds the pipeline has spent (every step but the waits). */
  mainMs: number;
}

export interface FrameSpanInput {
  label: string;
  from: VideoStatsSample;
  to: VideoStatsSample;
  /** When the recording started (epoch ms): time zero of the file. */
  startedAt: number;
  /** Timestamps (s) of the video frames in the file. */
  frameTimes: readonly number[];
}

export interface FrameSpanVerdict {
  verdict: 'ok' | 'overloaded' | 'stalled';
  /** The span on the file's timeline (s). */
  fromS: number;
  toS: number;
  frames: number;
  needed: number;
  /** The lower of the rates the recorder aimed for at the span's ends. */
  targetFps: number;
  /** What the pipeline cost over the span, as the recorder measures it. */
  mainMsPerS: number;
  busyRatio: number;
  summary: string;
}

/** Share of the frames the target rate asks for that a span must hold. */
const MIN_SHARE = 0.6;

export function judgeFrameSpan(input: FrameSpanInput): FrameSpanVerdict {
  const { from, to } = input;
  const fromS = (from.at - input.startedAt) / 1000;
  const toS = (to.at - input.startedAt) / 1000;
  const seconds = toS - fromS;
  const frames = input.frameTimes.filter((t) => t >= fromS && t < toS).length;
  const targetFps = Math.min(from.fps, to.fps);
  const needed = Math.floor(MIN_SHARE * targetFps * seconds);
  const ticks = to.ticks - from.ticks;
  const busyTicks = to.busyTicks - from.busyTicks;
  const mainMsPerS = (to.mainMs - from.mainMs) / seconds;
  const busyRatio = busyTicks / Math.max(1, ticks + busyTicks);
  const overloaded = mainMsPerS > OVERLOAD_MS_PER_S || busyRatio > BUSY_RATIO_DOWN;
  const verdict = frames >= needed ? 'ok' : overloaded ? 'overloaded' : 'stalled';
  const summary =
    `${input.label} ${fromS.toFixed(1)}-${toS.toFixed(1)} s: ${frames} frames, needs ${needed} ` +
    `(${MIN_SHARE * 100} % of ${targetFps} fps over ${seconds.toFixed(1)} s); ` +
    `recorder load ${Math.round(mainMsPerS)} ms/s of the main thread, ` +
    `${Math.round(busyRatio * 100)} % of ticks skipped → ${verdict}`;
  return { verdict, fromS, toS, frames, needed, targetFps, mainMsPerS, busyRatio, summary };
}
