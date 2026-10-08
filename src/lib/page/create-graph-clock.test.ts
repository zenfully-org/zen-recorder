import { describe, expect, it } from 'vitest';
import { createGraphClock } from './create-graph-clock';

/** A graph clock read at scripted moments: `at(wall, graph)` is one reading of both clocks. */
function setup(start: { wall: number; graph: number } = { wall: 100, graph: 0 }) {
  let wall = start.wall;
  let graph = start.graph;
  const clock = createGraphClock({ now: () => wall, graphTime: () => graph });
  return {
    clock,
    at(nextWall: number, nextGraph: number) {
      wall = nextWall;
      graph = nextGraph;
      return clock.read();
    },
  };
}

describe('createGraphClock', () => {
  it('tells the graph time now from the wall clock while the graph runs', () => {
    const { clock, at } = setup();
    expect(at(100.1, 0.1)).toBeCloseTo(0.1, 9);
    expect(at(100.5, 0.5)).toBeCloseTo(0.5, 9);
    expect(clock.takeStops()).toEqual([]);
  });

  it('is not misled by a reading the busy page has not updated yet', () => {
    const { clock, at } = setup();
    at(101, 1);
    // A 2.5 s long task: the page still shows the graph time from before it.
    expect(at(103.5, 1)).toBeCloseTo(3.5, 9);
    expect(at(103.6, 3.6)).toBeCloseTo(3.6, 9);
    expect(clock.takeStops()).toEqual([]);
  });

  it.each([
    ['slow', 0.995],
    ['fast', 1.005],
  ])('follows a device clock 0.5 %% %s against the wall clock, with no stop', (_label, rate) => {
    const { clock, at } = setup();
    let graphNow = 0;
    for (let step = 1; step <= 36_000; step++) {
      graphNow = at(100 + step / 10, (step / 10) * rate);
    }
    expect(clock.takeStops()).toEqual([]);
    expect(Math.abs(graphNow - 3600 * rate)).toBeLessThan(0.15);
  });

  it('measures a stop: the graph stands still while wall time runs', () => {
    const { clock, at } = setup();
    at(101, 1);
    at(101.1, 1.1);
    // Suspended with no event: the page keeps reading the same graph time.
    expect(at(101.5, 1.1)).toBeCloseTo(1.5, 9);
    expect(at(104.1, 1.1)).toBeCloseTo(4.1, 9);
    expect(clock.takeStops()).toEqual([]);
    // Running again: the graph was at 1.2 by 104.2, so it stood still for 3 s at most; it moved
    // after 104.1, so for 2.9 s at least. The stop is the upper bound, which no later reading
    // can pass.
    expect(at(104.2, 1.2)).toBeCloseTo(1.2, 9);
    const [stop, ...others] = clock.takeStops();
    expect(others).toEqual([]);
    expect(stop?.at).toBe(1.1);
    expect(stop?.seconds).toBeCloseTo(3, 9);
    expect(clock.takeStops()).toEqual([]);
  });

  it('measures a graph that starts after the clock (a new context), however short the wait', () => {
    const late = setup();
    late.at(100.5, 0);
    late.at(101.4, 0);
    late.at(101.45, 0.05);
    const [stop] = late.clock.takeStops();
    expect(stop?.at).toBe(0);
    expect(stop?.seconds).toBeCloseTo(1.4, 9);
    const brief = setup();
    brief.at(100.1, 0);
    brief.at(100.2, 0);
    brief.at(100.21, 0.01);
    expect(brief.clock.takeStops()[0]?.seconds).toBeCloseTo(0.2, 9);
  });

  it('measures the start-up in one piece when the busy page reads the clocks seldom', () => {
    const { clock, at } = setup();
    at(100.7, 0);
    // The graph starts at 101.33; the next reading only comes at 101.4, then they come often.
    at(101.4, 0.07);
    at(101.45, 0.12);
    at(101.5, 0.17);
    const stops = clock.takeStops();
    expect(stops).toHaveLength(1);
    expect(stops[0]?.seconds).toBeCloseTo(1.33, 9);
  });

  it('measures nothing at the start of a graph that was already running', () => {
    const { clock, at } = setup({ wall: 100, graph: 7 });
    at(100.05, 7.05);
    at(100.1, 7.1);
    expect(clock.takeStops()).toEqual([]);
  });

  it('lets a stall shorter than a quarter second pass', () => {
    const { clock, at } = setup();
    at(101, 1);
    at(101.2, 1);
    at(101.25, 1.05);
    expect(clock.takeStops()).toEqual([]);
  });

  it('measures a graph that runs at half speed, in stops of a quarter second or more', () => {
    const { clock, at } = setup();
    at(100.1, 0.1);
    for (let step = 2; step <= 61; step++) at(100 + step / 10, 0.1 + (step - 1) / 20);
    const stops = clock.takeStops();
    expect(stops.length).toBeGreaterThan(5);
    expect(stops.every((stop) => stop.seconds > 0.25)).toBe(true);
    const total = stops.reduce((sum, stop) => sum + stop.seconds, 0);
    expect(total).toBeGreaterThan(2.6);
    expect(total).toBeLessThan(3);
  });
});
