import { describe, expect, it } from 'vitest';
import { createAudioQueue } from './create-audio-queue';

const RATE = 48_000;
/** `frames` samples of `value`. */
const samples = (frames: number, value = 0.5) => new Float32Array(frames).fill(value);
/** Lets the queue start the write whose turn it is. */
const settle = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

/** A muxer that writes each sample only when the test lets it. */
function setup() {
  const written: { frames: number; first: number; timestamp: number }[] = [];
  const errors: unknown[] = [];
  const waiting: (() => void)[] = [];
  const queue = createAudioQueue({
    write: (data, rate, timestamp) => {
      expect(rate).toBe(RATE);
      written.push({ frames: data.length, first: data[0] ?? Number.NaN, timestamp });
      return new Promise<void>((resolve) => waiting.push(resolve));
    },
    onError: (error) => errors.push(error),
  });
  /** The muxer takes the sample it is writing. */
  const take = async () => {
    waiting.shift()?.();
    await settle();
  };
  return { queue, written, errors, take };
}

describe('createAudioQueue', () => {
  it('writes the audio added while a write is under way in one sample when its turn comes, where its first part goes', async () => {
    const { queue, written, take } = setup();
    queue.audio(samples(2048, 0.1), RATE, 0);
    await settle();
    // Added while the first is being written: they wait for their turn, together.
    queue.audio(samples(2048, 0.2), RATE, 2048 / RATE);
    queue.audio(samples(1024, 0.3), RATE, 4096 / RATE);
    expect(queue.pendingSeconds()).toBeCloseTo(5120 / RATE, 6);
    await take();
    expect(written).toEqual([
      { frames: 2048, first: Math.fround(0.1), timestamp: 0 },
      { frames: 3072, first: Math.fround(0.2), timestamp: 2048 / RATE },
    ]);
    await take();
    await queue.idle();
    expect(queue.pendingSeconds()).toBe(0);
  });

  it('never joins across a gap: audio after a silence, or audio that does not follow, keeps its own place', async () => {
    const { queue, written, take } = setup();
    queue.audio(samples(2048), RATE, 0);
    await settle();
    queue.audio(samples(2048), RATE, 2048 / RATE);
    // The clock found 0.1 s where the graph captured nothing: silence, then the audio after it.
    queue.silence(4800, RATE, 4096 / RATE);
    queue.audio(samples(2048), RATE, 8896 / RATE);
    // Audio that does not follow the audio waiting before it.
    queue.audio(samples(2048), RATE, 20_000 / RATE);
    for (let turn = 0; turn < 5; turn++) await take();
    expect(written.map(({ frames, timestamp }) => [frames, timestamp])).toEqual([
      [2048, 0],
      [2048, 2048 / RATE],
      [4800, 4096 / RATE],
      [2048, 8896 / RATE],
      [2048, 20_000 / RATE],
    ]);
  });

  it('writes silence a second at a time when its turn comes, and never joins audio of another rate', async () => {
    const { queue, written, take } = setup();
    queue.silence(RATE + 100, RATE, 3);
    for (let turn = 0; turn < 2; turn++) await take();
    expect(written.map(({ frames, timestamp }) => [frames, timestamp])).toEqual([
      [RATE, 3],
      [100, 4],
    ]);
    const rates: number[] = [];
    const spy = createAudioQueue({
      write: async (data, rate) => void rates.push(rate, data.length),
      onError: () => undefined,
    });
    spy.audio(samples(4), RATE, 0);
    spy.audio(samples(4), RATE, 4 / RATE);
    spy.audio(samples(4), 44_100, 8 / RATE);
    await spy.idle();
    expect(rates).toEqual([RATE, 8, 44_100, 4]);
  });

  it('reports a write that fails and goes on with the next', async () => {
    const errors: unknown[] = [];
    const failure = new Error('muxer closed');
    const written: number[] = [];
    const queue = createAudioQueue({
      write: async (data) => {
        written.push(data.length);
        if (written.length === 1) throw failure;
      },
      onError: (error) => errors.push(error),
    });
    queue.audio(samples(8), RATE, 0);
    await queue.idle();
    queue.audio(samples(16), RATE, 8 / RATE);
    await queue.idle();
    expect(errors).toEqual([failure]);
    expect(written).toEqual([8, 16]);
    expect(queue.pendingSeconds()).toBe(0);
  });
});
