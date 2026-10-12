/**
 * How long each recording was paused, in wall time: each pause as it ends (a Resume, or the stop of
 * a recording stopped while paused), and the total, which the recording's end carries. The file
 * holds none of it.
 */
export function createPauseTally() {
  const tallies = new Map<string, { since: number | null; total: number }>();
  return {
    /** Recording `id` paused at `atMs`; a pause already open keeps its start. */
    paused(id: string, atMs: number): void {
      const tally = tallies.get(id) ?? { since: null, total: 0 };
      tallies.set(id, { ...tally, since: tally.since ?? atMs });
    },
    /** The open pause of `id` ends at `atMs`: how long it lasted, 0 when none was open. */
    ended(id: string, atMs: number): number {
      const tally = tallies.get(id);
      if (tally?.since == null) return 0;
      // A clock set back during the pause gives no negative pause.
      const pausedMs = Math.max(0, atMs - tally.since);
      tallies.set(id, { since: null, total: tally.total + pausedMs });
      return pausedMs;
    },
    /** Every pause of `id` that ended. */
    total: (id: string): number => tallies.get(id)?.total ?? 0,
  };
}
