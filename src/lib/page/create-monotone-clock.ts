/** A position that never goes back. */
export interface MonotoneClock {
  /** The source's value, or the highest one read before if it is lower; 0 before any. */
  read(): number;
  /** Reads once more, then stands still there for good; returns that position. */
  freeze(): number;
}

/**
 * Follows `source` forward only, and stands still once frozen: a recording's place in its file
 * never goes back, and stays where its stop found it. `source` gives null while there is nothing
 * to read.
 */
export function createMonotoneClock(source: () => number | null): MonotoneClock {
  let last = 0;
  let frozen = false;
  const read = (): number => {
    if (!frozen) last = Math.max(last, source() ?? 0);
    return last;
  };
  return {
    read,
    freeze() {
      read();
      frozen = true;
      return last;
    },
  };
}
