/**
 * Waits until a meeting page has run for `ms` since the run last changed something in it.
 *
 * The page writes some states in its notes only once they held for a while (a mute, a hidden tab,
 * a new title), and it first sees each one when it runs. Firefox can block the page's main thread
 * on a snapshot of a canvas a worker paints, until the worker answers or for its 10 s snapshot
 * timeout. Waiting `ms` of wall time, the run changed the state again, or stopped, before the page
 * had seen it hold. So the wait asks the page for nothing every 250 ms, and counts `ms` again from
 * an answer that came back more than 1 s late: the page ran again then. It gives up 30 s past `ms`,
 * so a page that never answers in time fails on what its notes say instead of hanging the run.
 */

/** How often the page is asked, and how late an answer says the page could not run. */
const PING_MS = 250;
const LATE_MS = 1_000;
const GIVE_UP_AFTER_MS = 30_000;

export async function letPageRun(
  ms: number,
  deps: { ping: () => Promise<unknown>; now: () => number; sleep: (ms: number) => Promise<void> },
): Promise<void> {
  const start = deps.now();
  let ranSince = start;
  for (;;) {
    const left = ms - (deps.now() - ranSince);
    if (left <= 0 || deps.now() - start >= ms + GIVE_UP_AFTER_MS) return;
    await deps.sleep(Math.min(PING_MS, left));
    const asked = deps.now();
    await deps.ping();
    if (deps.now() - asked > LATE_MS) ranSince = deps.now();
  }
}
