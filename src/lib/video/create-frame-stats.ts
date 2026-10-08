/**
 * Statistics of the video pipeline: what each composite frame cost on the page's main thread
 * (find the tiles, lay them out, draw them, build the `VideoFrame`, hand it to the encoder), how
 * long it then waited for encoder backpressure, and how many clock ticks were skipped because
 * nothing changed or because the previous frame was still in flight. Feeds the adaptive frame
 * rate, the diagnostics log and the benchmark. History is bounded (a recording lasts hours).
 */

/** Milliseconds one frame spent in each step. `wait` is backpressure, not main-thread work. */
export interface FrameTimings {
  find: number;
  layout: number;
  draw: number;
  frame: number;
  encode: number;
  wait: number;
}

export interface FrameStatsSnapshot {
  /** Clock ticks that ran. */
  ticks: number;
  /** Clock ticks skipped because the previous frame was still in flight. */
  busyTicks: number;
  /** Ticks that drew nothing because no tile changed. */
  unchanged: number;
  /** Frames handed to the encoder. */
  encoded: number;
  /** Cumulative milliseconds per step since the recording started. */
  sums: FrameTimings;
  /** 95th percentile per step over the last frames; `total` is the main-thread part. */
  p95: FrameTimings & { total: number };
}

export interface RecentLoad {
  encodedPerS: number;
  ticksPerS: number;
  busyPerS: number;
  /** Mean main-thread milliseconds per encoded frame. */
  mainMsPerFrame: number;
  /** Main-thread milliseconds the pipeline used per second of wall time. */
  mainMsPerS: number;
  /** Mean milliseconds a frame waited (snapshots arriving, encoder backpressure). */
  waitMsPerFrame: number;
  /** 95th percentile of the main-thread milliseconds of one frame in the window. */
  p95MainMs: number;
}

export interface FrameStats {
  tick(at: number): void;
  busy(at: number): void;
  unchanged(at: number): void;
  frame(at: number, timings: FrameTimings): void;
  snapshot(): FrameStatsSnapshot;
  /** The load over the `windowMs` before `now` (at most the retained history). */
  recent(now: number, windowMs: number): RecentLoad;
  /** Entries currently held in memory (for tests and leak checks). */
  retained(): number;
}

export interface FrameStatsOptions {
  /** Frames the percentiles are computed over. */
  window?: number;
  /** How far back `recent` can look. */
  retainMs?: number;
}

const PHASES = ['find', 'layout', 'draw', 'frame', 'encode', 'wait'] as const;

const mainThreadMs = (t: FrameTimings): number => t.find + t.layout + t.draw + t.frame + t.encode;

function percentile95(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(0.95 * (sorted.length - 1))] ?? 0;
}

export function createFrameStats(options: FrameStatsOptions = {}): FrameStats {
  const window = options.window ?? 150;
  const retainMs = options.retainMs ?? 10_000;
  const counts = { ticks: 0, busyTicks: 0, unchanged: 0, encoded: 0 };
  const sums: FrameTimings = { find: 0, layout: 0, draw: 0, frame: 0, encode: 0, wait: 0 };
  const last: FrameTimings[] = [];
  const tickTimes: number[] = [];
  const busyTimes: number[] = [];
  const frames: { at: number; main: number; wait: number }[] = [];

  const prune = (now: number): void => {
    const oldest = now - retainMs;
    while ((tickTimes[0] ?? now) < oldest) tickTimes.shift();
    while ((busyTimes[0] ?? now) < oldest) busyTimes.shift();
    while ((frames[0]?.at ?? now) < oldest) frames.shift();
  };

  return {
    tick(at) {
      counts.ticks++;
      tickTimes.push(at);
      prune(at);
    },
    busy(at) {
      counts.busyTicks++;
      busyTimes.push(at);
      prune(at);
    },
    unchanged() {
      counts.unchanged++;
    },
    frame(at, timings) {
      counts.encoded++;
      for (const phase of PHASES) sums[phase] += timings[phase];
      last.push(timings);
      if (last.length > window) last.shift();
      frames.push({ at, main: mainThreadMs(timings), wait: timings.wait });
      prune(at);
    },
    snapshot() {
      const p95 = { find: 0, layout: 0, draw: 0, frame: 0, encode: 0, wait: 0, total: 0 };
      for (const phase of PHASES) p95[phase] = percentile95(last.map((t) => t[phase]));
      p95.total = percentile95(last.map(mainThreadMs));
      return { ...counts, sums: { ...sums }, p95 };
    },
    recent(now, windowMs) {
      const from = now - windowMs;
      const seconds = windowMs / 1000;
      const inWindow = frames.filter((f) => f.at >= from);
      const main = inWindow.reduce((sum, f) => sum + f.main, 0);
      const wait = inWindow.reduce((sum, f) => sum + f.wait, 0);
      const perFrame = (total: number): number =>
        inWindow.length === 0 ? 0 : total / inWindow.length;
      return {
        encodedPerS: inWindow.length / seconds,
        ticksPerS: tickTimes.filter((at) => at >= from).length / seconds,
        busyPerS: busyTimes.filter((at) => at >= from).length / seconds,
        mainMsPerFrame: perFrame(main),
        mainMsPerS: main / seconds,
        waitMsPerFrame: perFrame(wait),
        p95MainMs: percentile95(inWindow.map((f) => f.main)),
      };
    },
    retained: () => last.length + tickTimes.length + busyTimes.length + frames.length,
  };
}
