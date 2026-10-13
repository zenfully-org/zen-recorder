/**
 * Judges where a meeting's notes place something the run made happen in the page (a mute, the tab
 * hidden or shown, a new title), against the time the page could see it.
 *
 * The page sees such a change when it runs: a `visibilitychange` listener at once, a title read at
 * the next tick. So the notes must place it within `tolerance` of when the run made it happen, as
 * long as the page could run then. Firefox can block the page's main thread on a snapshot of a
 * canvas a worker paints, until the worker answers or for its 10 s snapshot timeout; nothing in the
 * page runs meanwhile, and the change is seen only once the page runs again. A freeze that holds
 * that moment, or begins before the page saw the change (within the tolerance), moves the latest
 * place the notes may give to `tolerance` after the freeze ended, and the next freeze can move it
 * again. The notes never place it more than `tolerance` before the run made it happen.
 */

/** When canvas snapshots froze the page (ms into the file). */
export interface CanvasFreeze {
  from: number;
  to: number;
}

export interface SeenAtInput {
  /** What the notes place, as it starts the problem's line ("the tab shown at"). */
  label: string;
  /** Where the notes place it (ms into the file); undefined when they do not say it. */
  actual: number | undefined;
  /** When the run made it happen (ms into the file, by the run's clock). */
  at: number;
  /** How far from that the notes may place it while the page runs. */
  tolerance: number;
  freezes: readonly CanvasFreeze[];
}

/** No problem, or the one line that says where the notes place it and where they should. */
export function judgeSeenAt({ label, actual, at, tolerance, freezes }: SeenAtInput): string[] {
  const holding: CanvasFreeze[] = [];
  let latest = at + tolerance;
  for (const freeze of freezes.toSorted((a, b) => a.from - b.from)) {
    if (freeze.from > latest || freeze.to <= at) continue;
    holding.push(freeze);
    latest = Math.max(latest, freeze.to + tolerance);
  }
  const earliest = at - tolerance;
  if (actual !== undefined && actual >= earliest && actual <= latest) return [];
  if (holding.length === 0) return [`${label} ${String(actual)} ms, not ${at} ms`];
  const spans = holding.map((freeze) => `${freeze.from}-${freeze.to}`).join(', ');
  return [
    `${label} ${String(actual)} ms, not between ${earliest} and ${latest} ms (canvas snapshots froze the page ${spans} ms)`,
  ];
}
