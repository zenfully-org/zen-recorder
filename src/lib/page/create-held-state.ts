/**
 * A state that counts as changed only once its new value has held long enough, and is then told
 * as of the moment the new value was first seen: a flicker (a call that drops for a second, Zoom
 * showing "audio not joined" during its own reconnects) tells nothing. Each value may need its own
 * hold (`holdMs`), none for one that counts at once.
 */
export function createHeldState<Value, Seen = unknown>(options: {
  initial: Value;
  holdMs: (value: Value) => number;
}) {
  let settled = options.initial;
  let pending: { value: Value; atMs: number; seen: Seen } | null = null;

  return {
    /**
     * `value` as observed at `atMs`. Returns the change it settles, once: the new value, what
     * `seen` read when that value was first observed, and the value before it.
     */
    observe(
      value: Value,
      atMs: number,
      seen: () => Seen,
    ): { value: Value; seen: Seen; from: Value } | null {
      if (value === settled) {
        pending = null;
        return null;
      }
      if (pending?.value !== value) pending = { value, atMs, seen: seen() };
      if (atMs - pending.atMs < options.holdMs(value)) return null;
      const change = { value, seen: pending.seen, from: settled };
      settled = value;
      pending = null;
      return change;
    },
  };
}
