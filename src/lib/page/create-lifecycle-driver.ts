/**
 * Holds the page's recording lifecycle: feeds each event to the reducer and hands its effects on.
 *
 * The reducer acts on events, and the session ticks once a second, but a recording whose
 * connections are all gone is due to stop at a moment no event marks: the end of the grace that
 * starts when the last connection went. The driver wakes the reducer then with a `tick`, so the
 * recording stops on time instead of at the next tick after it. That is the only thing it
 * dispatches, only at the deadline and only while the deadline stands (a connection back cancels
 * it). Nothing else is dispatched on a timer: the reducer takes inputs it already holds for a
 * tick, so refreshing them every second would only add work.
 *
 * Firefox runs timers on its monotonic clock, and `Date.now()` can lag it: a 5 s timer fired 2 ms
 * before the wall clock reached its deadline, the reducer did not stop yet, and the stop waited
 * for the next tick. A wake that comes early waits for the rest.
 */
import {
  type LifecycleConfig,
  type LifecycleEffect,
  type LifecycleEvent,
  type LifecycleState,
  reduceLifecycle,
} from '@/lib/page/reduce-lifecycle';
import type { RecordingState } from '@/lib/types';

export interface LifecycleDriverDeps {
  win: { setTimeout(handler: () => void, ms: number): number; clearTimeout(id: number): void };
  /** The clock the events are stamped with. */
  now: () => number;
  config: () => LifecycleConfig;
  apply: (effects: LifecycleEffect[]) => void;
}

export interface LifecycleDriver {
  /** undefined until the first event. */
  state(): LifecycleState | undefined;
  dispatch(event: LifecycleEvent): void;
  dispose(): void;
}

const RUNNING = new Set<RecordingState>(['recording', 'paused']);

/** When the connection-loss rule stops the running recording unless something changes first. */
function connectionLossDeadline(state: LifecycleState, config: LifecycleConfig): number | null {
  if (!RUNNING.has(state.status) || !state.connectedDuringRecording) return null;
  return state.disconnectedSince === null
    ? null
    : state.disconnectedSince + config.deadConnectionGraceMs;
}

export function createLifecycleDriver(deps: LifecycleDriverDeps): LifecycleDriver {
  let state: LifecycleState | undefined;
  let wake: { at: number; timer: number } | null = null;

  const arm = (at: number | null): void => {
    if (at === wake?.at) return;
    if (wake) deps.win.clearTimeout(wake.timer);
    wake = at === null ? null : { at, timer: deps.win.setTimeout(() => due(at), at - deps.now()) };
  };

  const due = (at: number): void => {
    wake = null;
    const now = deps.now();
    if (now < at) arm(at);
    // At its deadline the reducer stops the recording, which leaves no deadline to arm again.
    else dispatch({ type: 'tick', now });
  };

  const dispatch = (event: LifecycleEvent): void => {
    const next = reduceLifecycle(state, event, deps.config());
    state = next.state;
    deps.apply(next.effects);
    // `apply` may have dispatched again: the deadline is the newest state's.
    arm(connectionLossDeadline(state, deps.config()));
  };

  return { state: () => state, dispatch, dispose: () => arm(null) };
}
