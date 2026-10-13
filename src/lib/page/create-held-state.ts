/**
 * A state that counts as changed only once its new value has held long enough, and is then told
 * as of the moment the new value was first seen: a flicker (a call that drops for a second, Zoom
 * showing "audio not joined" during its own reconnects) tells nothing. Each change may need its own
 * hold (`holdMs`, by the new value and the one it replaces), none for one that counts at once.
 *
 * How long a value held is what the observations saw: from the first that showed it to the first
 * that showed something else, or to a moment nothing was observed after (`heldBy`, for a stop).
 * The page observes when it runs, once a second, and later than that on a busy page: judged only
 * by an observation while it still held, a 5 s mute that ended before the first observation after
 * its fourth second was never told.
 */
export function createHeldState<Value, Seen = unknown>(options: {
  initial: Value;
  holdMs: (value: Value, from: Value) => number;
}) {
  type Change = HeldChange<Value, Seen>;
  let settled = options.initial;
  let pending: { value: Value; atMs: number; seen: Seen } | null = null;

  /** The change the pending value makes once it held by `atMs`, without counting it. */
  const heldBy = (atMs: number): Change | null =>
    pending && atMs - pending.atMs >= options.holdMs(pending.value, settled)
      ? { value: pending.value, seen: pending.seen, from: settled }
      : null;
  /** Counts `change`, which `heldBy` gave. */
  const settle = (change: Change): Change => {
    settled = change.value;
    pending = null;
    return change;
  };

  return {
    /**
     * `value` as observed at `atMs`. Returns the changes it settles, each once: one that held
     * until this observation showed something else, then one that holds now, if any.
     */
    observe(value: Value, atMs: number, seen: () => Seen): Change[] {
      const told: Change[] = [];
      if (pending?.value !== value) {
        const ended = heldBy(atMs);
        if (ended) told.push(settle(ended));
        pending = value === settled ? null : { value, atMs, seen: seen() };
      }
      const held = heldBy(atMs);
      if (held) told.push(settle(held));
      return told;
    },
    /**
     * The change the pending value makes if it still holds at `atMs`, without counting it: for a
     * stop, after which nothing is observed. Asked again, it says the same.
     */
    heldBy,
  };
}

/** A change it counts: the new value, what `seen` read when first observed, the one before. */
export interface HeldChange<Value, Seen> {
  value: Value;
  seen: Seen;
  from: Value;
}
