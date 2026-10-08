import { describe, expect, it } from 'vitest';
import type { GraphClock, GraphStop } from './create-graph-clock';
import { createMediaClock } from './create-media-clock';

const RATE = 48_000;

/** A media clock over a scripted graph clock: `graphNow` is what it reads, `stop()` adds a stop. */
function setup(start = 0) {
  const graph: { now: number; stops: GraphStop[] } = { now: start, stops: [] };
  const graphClock: GraphClock = {
    read: () => graph.now,
    takeStops: () => graph.stops.splice(0),
  };
  const clock = createMediaClock({ graph: graphClock });
  let written = 0;
  return {
    clock,
    graph,
    /**
     * Places a buffer of `seconds` captured at graph time `at`, then writes it and its silence;
     * returns the silence.
     */
    place(at: number, seconds: number) {
      const gaps = clock.place(
        { frame: Math.round(at * RATE), frames: Math.round(seconds * RATE), sampleRate: RATE },
        written,
      );
      const silence = gaps.reduce((sum, gap) => sum + gap.seconds, 0);
      written += silence + seconds;
      return silence;
    },
    written: () => written,
  };
}

describe('createMediaClock', () => {
  it('writes buffers that follow each other back to back', () => {
    const { place, written } = setup();
    expect(place(0, 0.5)).toBe(0);
    expect(place(0.5, 0.5)).toBe(0);
    expect(written()).toBe(1);
  });

  it('starts the audio where the graph captured it: the time before is silence', () => {
    const { place } = setup(2);
    expect(place(2.4, 0.5)).toBeCloseTo(0.4, 9);
    expect(place(2.9, 0.5)).toBe(0);
  });

  it('puts the silence for a stop of the graph before the next buffer', () => {
    const { graph, place } = setup();
    place(0, 1);
    graph.stops.push({ at: 1, seconds: 3 });
    expect(place(1, 1)).toBe(3);
    expect(place(2, 1)).toBe(0);
  });

  it('cuts the silence for a stop into the buffer, at the graph time it happened', () => {
    const { clock, graph } = setup();
    graph.stops.push({ at: 0.75, seconds: 2 }, { at: 1, seconds: 1 });
    const buffer = { frame: 0, frames: RATE, sampleRate: RATE };
    expect(clock.place(buffer, 0)).toEqual([{ offset: 36_000, seconds: 2 }]);
    // The stop at the buffer's end goes before the next one.
    expect(clock.place({ ...buffer, frame: RATE }, 3)).toEqual([{ offset: 0, seconds: 1 }]);
  });

  it('keeps a stop measured ahead of the buffers the busy page has not got yet', () => {
    const { graph, place } = setup();
    graph.now = 3;
    graph.stops.push({ at: 2, seconds: 1 });
    expect(place(0, 1)).toBe(0);
    expect(place(1, 1)).toBe(0);
    expect(place(2, 1)).toBe(1);
  });

  it('puts a stop measured late before the next buffer, so no time is lost', () => {
    const { graph, place } = setup();
    place(0, 1);
    place(1, 1);
    graph.stops.push({ at: 0.9, seconds: 0.5 });
    expect(place(2, 1)).toBe(0.5);
  });

  it('fills frames the buffers skip (buffers the encoder dropped)', () => {
    const { place } = setup();
    place(0, 1);
    expect(place(1.5, 1)).toBeCloseTo(0.5, 9);
  });

  it('never writes silence for a buffer whose place the file has passed', () => {
    const { clock } = setup();
    const at = { frame: RATE, frames: RATE, sampleRate: RATE };
    expect(clock.place(at, 3)).toEqual([]);
  });

  it('tells where in the file this moment goes, stops included', () => {
    const { clock, graph, place } = setup(10);
    graph.now = 10.25;
    expect(clock.now()).toBeCloseTo(0.25, 9);
    place(10, 1);
    graph.now = 11.5;
    graph.stops.push({ at: 11.2, seconds: 2 });
    expect(clock.now()).toBeCloseTo(3.5, 9);
    // The stop is placed once, before the next buffer, and counted once.
    expect(place(11, 1)).toBe(2);
    expect(clock.now()).toBeCloseTo(3.5, 9);
  });

  it('stands still while paused and goes on from there, without the paused audio', () => {
    const { clock, graph, place, written } = setup();
    place(0, 2);
    graph.now = 2;
    clock.pause();
    clock.pause();
    graph.now = 5;
    expect(clock.now()).toBe(2);
    graph.stops.push({ at: 3, seconds: 1 });
    clock.resume();
    clock.resume();
    expect(clock.now()).toBe(2);
    expect(place(5, 1)).toBe(0);
    expect(written()).toBe(3);
    graph.now = 6.5;
    expect(clock.now()).toBeCloseTo(3.5, 9);
  });

  it('writes audio from before a resume that arrives after it, and keeps the clock where it is', () => {
    const { clock, graph, place } = setup();
    place(0, 1);
    graph.now = 1.5;
    clock.pause();
    graph.now = 4;
    clock.resume();
    // Still queued for the busy page at the resume: captured from 1 s to 1.5 s, before the pause.
    expect(place(1, 0.5)).toBe(0);
    expect(clock.now()).toBe(1.5);
    expect(place(4, 1)).toBe(0);
    graph.now = 5;
    expect(clock.now()).toBe(2.5);
  });
});
