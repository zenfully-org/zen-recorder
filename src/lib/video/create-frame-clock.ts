/**
 * Drives the compositor at a fixed rate from a main-thread interval (never rAF: it stops in
 * background tabs, while timers stay unthrottled as long as the mixer's AudioContext runs).
 * A tick may skip drawing when nothing changed; a heartbeat forces one draw at least every
 * `heartbeatMs` so the encoder timeline keeps advancing.
 */

export interface FrameClockDeps {
  fps: number;
  heartbeatMs: number;
  setInterval: (handler: () => void, ms: number) => number;
  clearInterval: (id: number) => void;
  now: () => number;
  /** Returns whether a frame was drawn. */
  onTick: (info: { now: number; forced: boolean }) => boolean | Promise<boolean>;
  onError: (error: Error) => void;
  /** Called with the time of every tick skipped because the previous one was still running. */
  onBusy?: (at: number) => void;
}

export interface FrameClock {
  start(): void;
  stop(): void;
  setFps(fps: number): void;
  fps(): number;
  running(): boolean;
}

export function createFrameClock(deps: FrameClockDeps): FrameClock {
  let fps = deps.fps;
  let timer: number | null = null;
  let inFlight = false;
  let lastDrawAt: number | null = null;

  const tick = async (): Promise<void> => {
    const now = deps.now();
    if (inFlight) {
      deps.onBusy?.(now);
      return;
    }
    inFlight = true;
    const forced = lastDrawAt === null || now - lastDrawAt >= deps.heartbeatMs;
    try {
      if (await deps.onTick({ now, forced })) lastDrawAt = now;
    } catch (error) {
      deps.onError(error instanceof Error ? error : new Error(String(error)));
    } finally {
      inFlight = false;
    }
  };

  const start = (): void => {
    if (timer !== null) return;
    timer = deps.setInterval(() => void tick(), Math.round(1000 / fps));
  };

  const stop = (): void => {
    if (timer === null) return;
    deps.clearInterval(timer);
    timer = null;
  };

  return {
    start,
    stop,
    setFps(next) {
      const clamped = Math.min(30, Math.max(1, next));
      if (clamped === fps) return;
      fps = clamped;
      if (timer !== null) {
        stop();
        start();
      }
    },
    fps: () => fps,
    running: () => timer !== null,
  };
}
