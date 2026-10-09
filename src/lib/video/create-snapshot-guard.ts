/**
 * Keeps the compositor from snapshotting a canvas whose snapshots freeze the meeting page.
 *
 * A canvas a worker paints (Zoom's tiles) is snapshotted by posting to that worker and blocking
 * the page's main thread until it answers (Gecko's `OffscreenCanvasDisplayHelper::GetSurfaceSnapshot`,
 * up to `gfx.offscreencanvas.snapshot-timeout-ms`, 10 s). While the worker is busy, as Zoom's is
 * right after joining, every recorded frame froze the page for up to a second. A snapshot that
 * blocked longer than `LIMIT_MS` holds its canvas back for a while: its tiles are drawn as
 * placeholders, then the next snapshot tries again. The hold doubles while the canvas keeps
 * blocking, so a stuck worker costs one freeze a minute, and starts over once a snapshot is quick.
 */

export interface SnapshotGuard {
  /** Whether `canvas` may be snapshotted at `at` (ms). */
  allows(canvas: object, at: number): boolean;
  /** Records that a snapshot of `canvas` taken at `at` blocked the page for `ms`. */
  blocked(canvas: object, ms: number, at: number): void;
}

/** A snapshot that blocks the page longer than this holds its canvas back. */
const LIMIT_MS = 250;
const FIRST_HOLD_MS = 5_000;
const MAX_HOLD_MS = 60_000;

interface Stall {
  until: number;
  holdMs: number;
}

export function createSnapshotGuard(deps: { onLog?: (message: string) => void }): SnapshotGuard {
  const stalls = new WeakMap<object, Stall>();
  return {
    allows: (canvas, at) => at >= (stalls.get(canvas)?.until ?? 0),
    blocked(canvas, ms, at) {
      const stall = stalls.get(canvas);
      if (ms <= LIMIT_MS) {
        if (!stall) return;
        stalls.delete(canvas);
        deps.onLog?.(`canvas snapshots are quick again (${Math.round(ms)} ms)`);
        return;
      }
      const holdMs = stall ? Math.min(stall.holdMs * 2, MAX_HOLD_MS) : FIRST_HOLD_MS;
      stalls.set(canvas, { until: at + holdMs, holdMs });
      deps.onLog?.(
        `a canvas snapshot blocked the page for ${Math.round(ms)} ms: its tiles are drawn as placeholders for ${holdMs / 1_000} s`,
      );
    },
  };
}
