/**
 * The adaptive frame rate of the composited video: a pure decision taken once a second from what
 * the pipeline recently cost (`createFrameStats`). Everything runs on the meeting page's main
 * thread, so the budget is a share of that thread; the other overload sign is ticks the clock had
 * to skip because the previous frame was still being drawn or encoded (the encoder cannot keep
 * up). Long single frames do not lower the rate (a lower rate does not make them shorter), but
 * they keep it from going up.
 *
 * The rates are the configured rate divided by 1, 2, 3, … (15, 7.5, 5): the muxer snaps every
 * timestamp to the configured rate's grid, so any other rate would space the frames unevenly.
 * Down: to the highest of those rates that fits the budget (and that the encoder sustains), at
 * least one step, never below the floor. Up: one step once the load predicted at the higher rate
 * fits the budget, nothing is skipped and the hold time has passed. Every step down doubles the
 * hold time before the next attempt up, so a load that only fits the lower rate does not flap.
 */
import type { RecentLoad } from '@/lib/video/create-frame-stats';

/** The window of recent load the decision reads (and the wait after a change before deciding). */
export const RATE_WINDOW_MS = 5_000;
/** Main-thread milliseconds per second above which the rate goes down… */
export const OVERLOAD_MS_PER_S = 500;
/** …and the share it goes down to (and must fit before going up again). */
const BUDGET_MS_PER_S = 350;
/** Going up needs frames shorter than this (p95): a long task is 50 ms. */
const UPGRADE_FRAME_MS = 40;
/** Share of the clock's ticks skipped because a frame was still in flight. */
export const BUSY_RATIO_DOWN = 0.2;
const BUSY_RATIO_UP = 0.05;
const MAX_UPGRADE_HOLD_MS = 300_000;

export interface RateInput {
  /** The rate the clock runs at now. */
  fps: number;
  /** The rate the settings ask for: the ceiling. */
  nominalFps: number;
  minFps: number;
  /** The load over the last `RATE_WINDOW_MS`. */
  load: RecentLoad;
  /** Milliseconds since the rate last changed (or since the recording started). */
  sinceChangeMs: number;
  /** How long the rate must have held before going up. */
  upgradeHoldMs: number;
}

export interface RateDecision {
  /** The new rate and why (for the diagnostics log); null when the rate stays. */
  next: { fps: number; reason: string } | null;
  upgradeHoldMs: number;
}

/** The configured rate divided by 1, 2, 3, … while at or above the floor; highest first. */
function ladder(nominalFps: number, minFps: number): number[] {
  const rates = [nominalFps];
  for (let divisor = 2; nominalFps / divisor >= minFps; divisor++) rates.push(nominalFps / divisor);
  return rates;
}

export function decideVideoRate(input: RateInput): RateDecision {
  const { fps, load } = input;
  const stay: RateDecision = { next: null, upgradeHoldMs: input.upgradeHoldMs };
  if (input.sinceChangeMs < RATE_WINDOW_MS) return stay;
  const busyRatio = load.busyPerS / Math.max(1, load.ticksPerS + load.busyPerS);
  const overload =
    load.mainMsPerS > OVERLOAD_MS_PER_S
      ? `compositing takes ${Math.round(load.mainMsPerS)} ms/s of the main thread (${Math.round(load.mainMsPerFrame)} ms per frame)`
      : busyRatio > BUSY_RATIO_DOWN
        ? `only ${Math.round(load.ticksPerS)} of ${fps} frames/s get through (frames wait ${Math.round(load.waitMsPerFrame)} ms each)`
        : null;
  const rates = ladder(input.nominalFps, input.minFps);
  if (overload) {
    const lower = rates.filter((rate) => rate < fps);
    const lowest = lower.at(-1);
    if (lowest === undefined) return stay;
    const fitsBudget = BUDGET_MS_PER_S / load.mainMsPerFrame;
    const sustained = busyRatio > BUSY_RATIO_DOWN ? load.ticksPerS : fps;
    const limit = Math.min(fitsBudget, sustained);
    const next = lower.find((rate) => rate <= limit) ?? lowest;
    return {
      next: { fps: next, reason: overload },
      upgradeHoldMs: Math.min(MAX_UPGRADE_HOLD_MS, input.upgradeHoldMs * 2),
    };
  }
  const next = rates.filter((rate) => rate > fps).at(-1);
  const canGoUp =
    next !== undefined &&
    input.sinceChangeMs >= input.upgradeHoldMs &&
    busyRatio <= BUSY_RATIO_UP &&
    load.p95MainMs < UPGRADE_FRAME_MS &&
    load.mainMsPerFrame * next <= BUDGET_MS_PER_S;
  return canGoUp ? { ...stay, next: { fps: next, reason: 'the load allows a higher rate' } } : stay;
}
