// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { type FrameSpanVerdict, judgeFrameSpan, type VideoStatsSample } from './judge-frame-span';

const STARTED_AT = 1_000_000;

interface SpanShape {
  /** Where the span starts on the file's timeline, and how long it lasts (s). */
  fromS: number;
  seconds: number;
  /** The rate the recorder aimed for at either end. */
  fromFps: number;
  toFps: number;
  /** Frames in the file inside the span, evenly spread. */
  frames: number;
  /** What the recorder's statistics counted over the span. */
  ticks: number;
  busyTicks: number;
  mainMs: number;
}

function sample(atS: number, fps: number, counters: Omit<VideoStatsSample, 'at' | 'fps'>) {
  return { at: STARTED_AT + atS * 1000, fps, ...counters };
}

/** The input for a span of the given shape, with statistics counted from arbitrary earlier totals. */
function spanInput(shape: SpanShape) {
  const before = { ticks: 300, busyTicks: 4, mainMs: 2_500 };
  const frameTimes = Array.from(
    { length: shape.frames },
    (_, index) => shape.fromS + ((index + 0.5) * shape.seconds) / shape.frames,
  );
  return {
    label: 'hidden',
    startedAt: STARTED_AT,
    from: sample(shape.fromS, shape.fromFps, before),
    to: sample(shape.fromS + shape.seconds, shape.toFps, {
      ticks: before.ticks + shape.ticks,
      busyTicks: before.busyTicks + shape.busyTicks,
      mainMs: before.mainMs + shape.mainMs,
    }),
    frameTimes,
  };
}

describe('judgeFrameSpan', () => {
  it.each<SpanShape & { name: string; want: FrameSpanVerdict['verdict'] }>([
    {
      name: 'a span at the rate the recorder aimed for',
      ...{ fromS: 5, seconds: 6, fromFps: 15, toFps: 15, frames: 89 },
      ...{ ticks: 90, busyTicks: 0, mainMs: 1_200 },
      want: 'ok',
    },
    {
      name: 'a span at 60 % of the target, the least it may hold',
      ...{ fromS: 5, seconds: 6, fromFps: 15, toFps: 15, frames: 54 },
      ...{ ticks: 90, busyTicks: 0, mainMs: 1_200 },
      want: 'ok',
    },
    {
      name: 'a span the recorder lowered to 5 fps, held to 5 fps and not to 15',
      ...{ fromS: 5, seconds: 6, fromFps: 5, toFps: 5, frames: 29 },
      ...{ ticks: 30, busyTicks: 0, mainMs: 1_500 },
      want: 'ok',
    },
    {
      name: 'a span whose rate went down midway, held to the lower rate',
      ...{ fromS: 5, seconds: 6, fromFps: 15, toFps: 5, frames: 30 },
      ...{ ticks: 50, busyTicks: 0, mainMs: 2_000 },
      want: 'ok',
    },
    {
      name: 'a hidden tab that only gets the 1 s heartbeat frame',
      ...{ fromS: 5, seconds: 6, fromFps: 15, toFps: 15, frames: 6 },
      ...{ ticks: 90, busyTicks: 0, mainMs: 80 },
      want: 'stalled',
    },
    {
      name: 'a clock throttled to one tick a second',
      ...{ fromS: 5, seconds: 6, fromFps: 15, toFps: 15, frames: 6 },
      ...{ ticks: 6, busyTicks: 0, mainMs: 80 },
      want: 'stalled',
    },
    {
      name: 'a clock that stopped',
      ...{ fromS: 5, seconds: 6, fromFps: 15, toFps: 15, frames: 0 },
      ...{ ticks: 0, busyTicks: 0, mainMs: 0 },
      want: 'stalled',
    },
    {
      name: 'one frame short of 60 % with a light main thread',
      ...{ fromS: 5, seconds: 6, fromFps: 15, toFps: 15, frames: 53 },
      ...{ ticks: 90, busyTicks: 0, mainMs: 1_200 },
      want: 'stalled',
    },
    {
      name: 'a span whose compositing took over 500 ms/s of the main thread',
      ...{ fromS: 5, seconds: 6, fromFps: 15, toFps: 5, frames: 2 },
      ...{ ticks: 20, busyTicks: 0, mainMs: 3_006 },
      want: 'overloaded',
    },
    {
      name: 'a span with over 20 % of its ticks skipped behind a frame in flight',
      ...{ fromS: 5, seconds: 6, fromFps: 5, toFps: 5, frames: 3 },
      ...{ ticks: 23, busyTicks: 7, mainMs: 400 },
      want: 'overloaded',
    },
    {
      name: 'a span with exactly 500 ms/s and 20 % of its ticks skipped, not yet overloaded',
      ...{ fromS: 5, seconds: 6, fromFps: 15, toFps: 15, frames: 6 },
      ...{ ticks: 72, busyTicks: 18, mainMs: 3_000 },
      want: 'stalled',
    },
  ])('$name: $want', ({ name: _name, want, ...shape }) => {
    expect(judgeFrameSpan(spanInput(shape)).verdict).toBe(want);
  });

  it('counts only the frames whose file time falls inside the span, from the recording start', () => {
    const input = {
      ...spanInput({
        ...{ fromS: 4, seconds: 6, fromFps: 15, toFps: 15, frames: 0 },
        ...{ ticks: 90, busyTicks: 0, mainMs: 1_200 },
      }),
      frameTimes: [3.99, 4, 7, 9.99, 10, 12],
    };
    expect(judgeFrameSpan(input)).toMatchObject({ fromS: 4, toS: 10, frames: 3, needed: 54 });
  });

  it('reports the recorder load it judged by', () => {
    const verdict = judgeFrameSpan(
      spanInput({
        ...{ fromS: 5, seconds: 6, fromFps: 15, toFps: 5, frames: 2 },
        ...{ ticks: 15, busyTicks: 5, mainMs: 3_006 },
      }),
    );
    expect(verdict).toMatchObject({ targetFps: 5, mainMsPerS: 501, busyRatio: 0.25 });
  });

  it('says in one line what it counted, against what, and why', () => {
    const verdict = judgeFrameSpan(
      spanInput({
        ...{ fromS: 5, seconds: 6, fromFps: 15, toFps: 15, frames: 6 },
        ...{ ticks: 90, busyTicks: 0, mainMs: 80 },
      }),
    );
    expect(verdict.summary).toBe(
      'hidden 5.0-11.0 s: 6 frames, needs 54 (60 % of 15 fps over 6.0 s); ' +
        'recorder load 13 ms/s of the main thread, 0 % of ticks skipped → stalled',
    );
  });
});
