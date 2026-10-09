import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeAudioContext } from '@/test/fakes/create-fake-audio-context';
import { type AudioSamples, createAudioTap } from './create-audio-tap';

function setup(
  options: {
    worklet?: boolean | 'fail';
    bufferSize?: number;
    initialState?: AudioContextState;
  } = {},
) {
  const context = createFakeAudioContext({
    ...(options.worklet ? { worklet: options.worklet } : {}),
    ...(options.initialState ? { initialState: options.initialState } : {}),
  });
  const stream = new MediaStream();
  const received: AudioSamples[] = [];
  const urls: string[] = [];
  const revoked: string[] = [];
  const tap = createAudioTap({
    context: context as unknown as AudioContext,
    stream,
    ...(options.bufferSize ? { bufferSize: options.bufferSize } : {}),
    ...(options.worklet
      ? {
          AudioWorkletNode: context.AudioWorkletNode,
          createObjectURL: (blob) => {
            const url = context.createObjectURL(blob);
            urls.push(url);
            return url;
          },
          revokeObjectURL: (url) => revoked.push(url),
        }
      : {}),
    setTimeout: (handler, ms) => window.setTimeout(handler, ms),
    clearTimeout: (id) => window.clearTimeout(id),
    onSamples: (s) => received.push(s),
  });
  const frames = () => received.reduce((sum, s) => sum + s.data.length, 0);
  return {
    context,
    received,
    frames,
    tap,
    urls,
    revoked,
    node: () => context.workletNodes[0],
    processor: () => context.processors[0],
  };
}

/** Tracks whether a promise has settled, without awaiting it. */
function watch(promise: Promise<void>) {
  const state = { settled: false };
  void promise.then(() => {
    state.settled = true;
  });
  return state;
}

/** Lets queued microtasks run: the fake audio thread answers port messages on one. */
const settle = () => vi.advanceTimersByTimeAsync(0);

describe('createAudioTap', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('falls back to a ScriptProcessor wired source → processor → silent gain → destination', async () => {
    const { context, tap, processor } = setup();
    expect(tap.kind()).toBe('pending');
    await tap.ready;
    expect(tap.kind()).toBe('processor');
    expect(tap.bufferSize).toBe(16384);
    expect(processor()?.bufferSize).toBe(16384);
    expect(context.sources[0]?.connected).toEqual([processor()]);
    expect(processor()?.connected).toEqual([context.gains[0]]);
    expect(context.gains[0]?.gain.value).toBe(0);
    expect(context.gains[0]?.connected).toEqual([context.destination]);
  });

  it('honours a custom fallback buffer size', async () => {
    const { tap } = setup({ bufferSize: 4096 });
    await tap.ready;
    expect(tap.bufferSize).toBe(4096);
  });

  it('emits a private copy of each processor buffer with the context sample rate', async () => {
    const { received, tap, processor } = setup();
    await tap.ready;
    const buffer = new Float32Array([0.1, 0.2, 0.3]);
    processor()?.emitAudio(buffer);
    buffer[0] = 9;
    expect(received.length).toBe(1);
    expect(received[0]?.sampleRate).toBe(48_000);
    expect(Array.from(received[0]?.data ?? [])).toEqual([
      0.10000000149011612, 0.20000000298023224, 0.30000001192092896,
    ]);
  });

  it('prefers an AudioWorklet loaded from a blob module, which posts 2048-frame buffers', async () => {
    const { context, received, frames, tap, urls, revoked, node } = setup({ worklet: true });
    await tap.ready;
    expect(tap.kind()).toBe('worklet');
    expect(context.audioWorklet?.modules).toEqual(urls);
    expect(revoked).toEqual(urls);
    expect(context.processors).toEqual([]);
    expect(node()?.name).toBe('zen-recorder-tap');
    expect(node()?.options).toEqual({
      numberOfInputs: 1,
      numberOfOutputs: 1,
      channelCount: 1,
      channelCountMode: 'explicit',
    });
    expect(context.sources[0]?.connected).toEqual([node()]);
    expect(node()?.connected).toEqual([context.gains[0]]);
    node()?.render(new Float32Array(4800).fill(0.5));
    expect(received.map((s) => s.data.length)).toEqual([2048, 2048]);
    expect(received[0]).toEqual({
      data: new Float32Array(2048).fill(0.5),
      sampleRate: 48_000,
      frame: 0,
    });
    tap.dispose();
    node()?.render(new Float32Array(4096));
    expect(frames()).toBe(4096);
    expect(node()?.port.onmessage).toBeNull();
    expect(node()?.connected).toEqual([]);
  });

  it('reads the audio graph clock', async () => {
    const { context, tap, node } = setup({ worklet: true });
    await tap.ready;
    expect(tap.graphTime()).toBe(0);
    node()?.render(new Float32Array(4800));
    expect(tap.graphTime()).toBeCloseTo(4736 / 48_000, 9);
    context.advanceGraph(1);
    expect(tap.graphTime()).toBeCloseTo(1 + 4736 / 48_000, 9);
  });

  it('stamps each worklet buffer with the graph frame of its first sample', async () => {
    const { context, received, tap, node } = setup({ worklet: true });
    await tap.ready;
    // The graph ran half a second before the tap captured anything.
    context.advanceGraph(0.5);
    node()?.render(new Float32Array(4096));
    expect(received.map((s) => s.frame)).toEqual([24_000, 26_048]);
    // A flush posts the partly filled buffer from where it began; the next one follows it.
    node()?.render(new Float32Array(1024));
    await tap.capture(true);
    node()?.render(new Float32Array(2048));
    expect(received.map((s) => [s.frame, s.data.length])).toEqual([
      [24_000, 2048],
      [26_048, 2048],
      [28_096, 1024],
      [29_120, 2048],
    ]);
  });

  it('counts a quantum without input channels as 128 frames of silence', async () => {
    const { received, tap, node } = setup({ worklet: true });
    await tap.ready;
    node()?.render(new Float32Array(1024).fill(0.5));
    node()?.renderWithoutInput(1024);
    node()?.render(new Float32Array(2048).fill(0.5));
    expect(received.map((s) => s.frame)).toEqual([0, 2048]);
    expect(Array.from(received[0]?.data ?? []).slice(1020, 1028)).toEqual([
      0.5, 0.5, 0.5, 0.5, 0, 0, 0, 0,
    ]);
    expect(received[1]?.data.every((v) => v === 0.5)).toBe(true);
  });

  it("stamps processor buffers from the first one's playbackTime, then by counting", async () => {
    const { context, received, tap, processor } = setup();
    await tap.ready;
    context.advanceGraph(1);
    processor()?.emitAudio(new Float32Array(16384));
    // Later playbackTimes add the main thread's delay, which the page cannot know.
    const lagging = processor();
    if (!lagging) throw new Error('no processor');
    lagging.delaySeconds = 0.3;
    lagging.emitAudio(new Float32Array(16384));
    expect(received.map((s) => s.frame)).toEqual([48_000, 64_384]);
  });

  it('ignores a worklet message that is neither samples nor an answer', async () => {
    const { received, tap, node } = setup({ worklet: true });
    await tap.ready;
    node()?.queued.push('noise', { flushed: 'x' });
    node()?.deliver();
    expect(received).toEqual([]);
  });

  it('falls back to the processor when the worklet module fails to load', async () => {
    const { context, tap } = setup({ worklet: 'fail' });
    await tap.ready;
    expect(tap.kind()).toBe('processor');
    expect(context.processors.length).toBe(1);
  });

  it('attaches nothing when disposed before the worklet is ready', async () => {
    const { context, tap } = setup({ worklet: true });
    tap.dispose();
    await tap.ready;
    expect(tap.kind()).toBe('pending');
    expect(context.workletNodes).toEqual([]);
    expect(context.processors).toEqual([]);
  });

  it('disconnects everything and stops emitting once disposed', async () => {
    const { context, received, tap, processor } = setup();
    await tap.ready;
    tap.dispose();
    tap.dispose();
    processor()?.emitAudio(new Float32Array(4));
    expect(received).toEqual([]);
    expect(processor()?.onaudioprocess).toBeNull();
    expect(context.sources[0]?.connected).toEqual([]);
    expect(processor()?.connected).toEqual([]);
    expect(context.gains[0]?.connected).toEqual([]);
  });

  it('ignores a late callback after dispose', async () => {
    const { received, tap, processor } = setup();
    await tap.ready;
    const handler = processor()?.onaudioprocess;
    tap.dispose();
    handler?.({
      inputBuffer: { getChannelData: () => new Float32Array(2) },
    } as unknown as AudioProcessingEvent);
    expect(received).toEqual([]);
  });

  describe('capture', () => {
    it('stops passing buffers at the place of the call: the backlog and the partial buffer still pass', async () => {
      const { received, frames, tap, node } = setup({ worklet: true });
      await tap.ready;
      const busy = node();
      if (!busy) throw new Error('no worklet node');
      // A busy page: 40 quanta rendered, two full buffers queued, 1024 frames not posted yet.
      busy.holdMessages = true;
      busy.render(new Float32Array(5120).fill(0.5));
      const stopped = watch(tap.capture(false));
      await settle();
      busy.render(new Float32Array(4096).fill(0.9));
      // Two buffers, the partial one, the answer, then the first of what came after the call.
      expect(busy.queued.length).toBe(5);
      expect(stopped.settled).toBe(false);
      busy.holdMessages = false;
      busy.deliver();
      await settle();
      expect(stopped.settled).toBe(true);
      expect(frames()).toBe(5120);
      expect(received.every((s) => s.data.every((v) => v === 0.5))).toBe(true);
      await tap.capture(true);
      busy.render(new Float32Array(2048).fill(0.3));
      expect(frames()).toBe(5120 + 2048);
    });

    it('keeps waiting while the backlog arrives one buffer at a time', async () => {
      const { frames, tap, node } = setup({ worklet: true });
      await tap.ready;
      const busy = node();
      if (!busy) throw new Error('no worklet node');
      busy.holdMessages = true;
      busy.render(new Float32Array(2048 * 4));
      const stopped = watch(tap.capture(false));
      await settle();
      // Gecko hands the main thread one message per task: here one every 900 ms.
      for (let i = 0; i < 4; i++) {
        await vi.advanceTimersByTimeAsync(900);
        busy.deliver(1);
      }
      expect(stopped.settled).toBe(false);
      busy.deliver(1);
      await settle();
      expect(frames()).toBe(2048 * 4);
      expect(stopped.settled).toBe(true);
    });

    it('takes changes in call order, each at its own place', async () => {
      const { received, tap, node } = setup({ worklet: true });
      await tap.ready;
      const busy = node();
      if (!busy) throw new Error('no worklet node');
      busy.holdMessages = true;
      const paused = watch(tap.capture(false));
      await settle();
      busy.render(new Float32Array(1024).fill(0.9));
      const resumed = watch(tap.capture(true));
      await settle();
      busy.render(new Float32Array(2048).fill(0.3));
      busy.deliver(1);
      await settle();
      expect([paused.settled, resumed.settled]).toEqual([true, false]);
      busy.deliver();
      await settle();
      expect(resumed.settled).toBe(true);
      expect(received.map((s) => [s.data.length, s.data[0]])).toEqual([
        [2048, 0.30000001192092896],
      ]);
    });

    it('takes effect a second after the last buffer when no answer comes (a graph that does not run)', async () => {
      const { received, tap, node } = setup({ worklet: true, initialState: 'suspended' });
      await tap.ready;
      const stalled = node();
      if (!stalled) throw new Error('no worklet node');
      stalled.holdMessages = true;
      const paused = watch(tap.capture(false));
      await vi.advanceTimersByTimeAsync(999);
      expect(paused.settled).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect(paused.settled).toBe(true);
      // The late answer to the first change does not put the next one into effect.
      const resumed = watch(tap.capture(true));
      stalled.render(new Float32Array(0));
      stalled.deliver(1);
      await settle();
      expect(resumed.settled).toBe(false);
      stalled.deliver();
      await settle();
      expect(resumed.settled).toBe(true);
      expect(received).toEqual([]);
    });

    it('lets the next ScriptProcessor buffer through on a stop, and drops it on a resume', async () => {
      const { received, tap, processor } = setup();
      await tap.ready;
      const emit = (value: number) => processor()?.emitAudio(new Float32Array(16384).fill(value));
      const paused = watch(tap.capture(false));
      await settle();
      expect(paused.settled).toBe(false);
      emit(0.1); // holds the moment of the pause
      await settle();
      expect(paused.settled).toBe(true);
      emit(0.2);
      const resumed = watch(tap.capture(true));
      emit(0.3); // holds the moment of the resume, and the pause before it
      await settle();
      expect(resumed.settled).toBe(true);
      emit(0.4);
      expect(received.map((s) => Math.round((s.data[0] ?? 0) * 10) / 10)).toEqual([0.1, 0.4]);
      const idle = watch(tap.capture(false));
      await vi.advanceTimersByTimeAsync(1000);
      expect(idle.settled).toBe(true);
    });

    it('takes effect at once while nothing is attached, and settles what is pending on dispose', async () => {
      const early = setup({ worklet: true });
      await expect(early.tap.capture(false)).resolves.toBeUndefined();
      await early.tap.ready;
      early.node()?.render(new Float32Array(2048));
      expect(early.received).toEqual([]);
      const { tap, node } = setup({ worklet: true });
      await tap.ready;
      const held = node();
      if (!held) throw new Error('no worklet node');
      held.holdMessages = true;
      const waiting = watch(tap.capture(false));
      tap.dispose();
      await settle();
      expect(waiting.settled).toBe(true);
      await expect(tap.capture(true)).resolves.toBeUndefined();
    });
  });
});

describe('createAudioTap on a page busy with long tasks', () => {
  it('brings a page that takes one message per task everything the worklet kept, in its next message', async () => {
    const { received, tap, node } = setup({ worklet: true });
    await tap.ready;
    const worklet = node();
    if (!worklet) throw new Error('no worklet');
    // Gecko hands the page one message per task: ten buffers (430 ms) during long tasks.
    worklet.holdMessages = true;
    worklet.render(new Float32Array(10 * 2048).fill(0.25));
    for (let task = 0; task < 5; task++) {
      worklet.deliver(1);
      // The page answered as it took the message; the worklet sees it before its next quantum.
      worklet.render(new Float32Array(128));
    }
    // Before, five tasks brought five buffers; now the fifth brings the six the worklet kept.
    expect(received.map((s) => [s.frame, s.data.length])).toEqual([
      [0, 2048],
      [2048, 2048],
      [4096, 2048],
      [6144, 2048],
      [8192, 6 * 2048],
    ]);
    expect(received[4]?.data).toEqual(new Float32Array(6 * 2048).fill(0.25));
  });

  it('sends kept buffers that do not follow each other in the graph in messages of their own', async () => {
    const { context, received, tap, node } = setup({ worklet: true });
    await tap.ready;
    const worklet = node();
    if (!worklet) throw new Error('no worklet');
    worklet.holdMessages = true;
    worklet.render(new Float32Array(5 * 2048));
    // The graph ran 0.1 s that the tap did not see: the next buffer starts later.
    context.advanceGraph(0.1);
    worklet.render(new Float32Array(2048));
    worklet.deliver(1);
    worklet.render(new Float32Array(128));
    worklet.deliver();
    expect(received.map((s) => [s.frame, s.data.length])).toEqual([
      [0, 2048],
      [2048, 2048],
      [4096, 2048],
      [6144, 2048],
      [8192, 2048],
      [10240 + 4800, 2048],
    ]);
  });
});
