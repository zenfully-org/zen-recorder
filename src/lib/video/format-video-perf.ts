/**
 * One diagnostics line about what the video pipeline costs, from the start of the recording: the
 * frame rate it reaches, main-thread milliseconds per frame split by step, the share of the main
 * thread it takes, how long frames wait for the encoder and why ticks were skipped. This is the
 * line to read in a Diagnostics report from a real machine.
 */
import type { FrameStatsSnapshot } from '@/lib/video/create-frame-stats';

export interface VideoPerfInput {
  stats: FrameStatsSnapshot;
  /** The frame rate the clock runs at now, and the one the settings ask for. */
  fps: number;
  nominalFps: number;
  elapsedS: number;
}

const ms = (value: number): string => value.toFixed(value < 0.1 ? 2 : 1);

export function formatVideoPerf(input: VideoPerfInput): string {
  const { stats, elapsedS } = input;
  const { sums } = stats;
  const frames = Math.max(1, stats.encoded);
  const main = sums.find + sums.layout + sums.draw + sums.frame + sums.encode;
  const rate = elapsedS > 0 ? stats.encoded / elapsedS : 0;
  const share = elapsedS > 0 ? main / elapsedS : 0;
  const steps = [
    `find ${ms(sums.find / frames)}`,
    `layout ${ms(sums.layout / frames)}`,
    `draw ${ms(sums.draw / frames)}`,
    `frame ${ms(sums.frame / frames)}`,
    `encode ${ms(sums.encode / frames)}`,
  ].join(', ');
  return (
    `video perf after ${Math.round(elapsedS)} s: ${rate.toFixed(1)} frames/s encoded ` +
    `(target ${input.fps}/${input.nominalFps} fps), ` +
    `main thread ${(main / frames).toFixed(1)} ms/frame = ${Math.round(share)} ms/s ` +
    `(${steps}; p95 total ${stats.p95.total.toFixed(1)}), ` +
    `encoder wait ${(sums.wait / frames).toFixed(1)} ms/frame, ` +
    `ticks skipped: ${stats.unchanged} unchanged, ${stats.busyTicks} busy`
  );
}
