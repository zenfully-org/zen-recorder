/**
 * The audio graph's clock as the page sees it, held against the wall clock. The graph
 * runs on the audio device's clock; the page reads it through `AudioContext.currentTime`, which
 * Gecko updates in one runnable per trip through the page's task queue
 * (`MediaTrackGraphStableStateRunnable`), so a busy page reads it late, never ahead. The wall clock
 * is only needed for the time the graph does not run at all: before a new context starts, or while
 * the browser holds it suspended (Gecko's `SuspendFromChrome` sends no `statechange`).
 *
 * Each reading bounds the offset `wall - graph`: it is at most the reading's own `wall - graph`
 * (the graph was there by then), and, when the graph time moved since the previous reading, at
 * least the previous reading's wall time minus the new graph time (the page learnt it after that).
 * A stale reading can only loosen the bounds. The offset follows the upper bound down at once and
 * the lower bound up by at most `MAX_DRIFT` of the time passed, which takes in the device's drift.
 * A lower bound further up than `STOP_THRESHOLD_S` is a stop of the graph, and so is any lower
 * bound above the start the first time the graph time moves (a graph that had not run yet). The
 * stop lasts up to the upper bound: no later lower bound can pass it, so a stop the page saw
 * through sparse readings is not measured twice.
 */

export interface GraphClockDeps {
  /** The wall clock in seconds (monotonic: `performance.now() / 1000`). */
  now: () => number;
  /** The graph's clock as the page reads it (`AudioContext.currentTime`), in seconds. */
  graphTime: () => number;
}

/** Wall time the graph stood still: where (its graph time) and for how long. */
export interface GraphStop {
  at: number;
  seconds: number;
}

export interface GraphClock {
  /** Reads both clocks; returns the graph time now, as the wall clock carries it on (seconds). */
  read(): number;
  /** The stops measured since the last call, oldest first. */
  takeStops(): GraphStop[];
}

/** How far the device's clock may run from the wall clock (1 %, a hundred times a crystal's). */
const MAX_DRIFT = 0.01;
/** A graph that falls behind the wall clock by more than this has stood still. */
const STOP_THRESHOLD_S = 0.25;

export function createGraphClock(deps: GraphClockDeps): GraphClock {
  let last = { wall: deps.now(), graph: deps.graphTime() };
  let offset = last.wall - last.graph;
  /** Whether the graph time has moved yet, and the wall time it last did. */
  let running = false;
  let lastMove = last.wall;
  let stops: GraphStop[] = [];

  return {
    read() {
      const reading = { wall: deps.now(), graph: deps.graphTime() };
      const upper = reading.wall - reading.graph;
      offset = Math.min(offset, upper);
      if (reading.graph > last.graph) {
        const excess = last.wall - reading.graph - offset;
        if (excess > (running ? STOP_THRESHOLD_S : 0)) {
          stops = [...stops, { at: last.graph, seconds: upper - offset }];
          offset = upper;
        } else if (excess > 0) {
          offset += Math.min(excess, MAX_DRIFT * (reading.wall - lastMove));
        }
        running = true;
        lastMove = reading.wall;
      }
      last = reading;
      return reading.wall - offset;
    },
    takeStops() {
      const taken = stops;
      stops = [];
      return taken;
    },
  };
}
