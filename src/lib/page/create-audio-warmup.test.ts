import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAudioWarmup, type WarmContext } from './create-audio-warmup';

const initialState: AudioContextState = 'suspended';

/** A context as the browser hands it out: suspended until its graph runs, then `statechange`. */
function fakeContext(options: { failClose?: boolean } = {}) {
  const events = new EventTarget();
  const context = {
    state: initialState,
    closeCalls: 0,
    addEventListener: (type: string, listener: () => void) =>
      events.addEventListener(type, listener),
    close() {
      context.closeCalls++;
      context.state = 'closed';
      return options.failClose ? Promise.reject(new Error('already closed')) : Promise.resolve();
    },
    /** The graph starts (or the browser suspends it): the state changes and the page hears of it. */
    become(state: AudioContextState) {
      context.state = state;
      events.dispatchEvent(new Event('statechange'));
    },
  };
  return context;
}

type FakeContext = ReturnType<typeof fakeContext>;

function setup(options: { allowed?: boolean; failCreate?: boolean; failClose?: boolean } = {}) {
  const contexts: FakeContext[] = [];
  const logs: string[] = [];
  let allowed = options.allowed ?? true;
  const warmup = createAudioWarmup({
    createContext: (): WarmContext => {
      if (options.failCreate) throw new Error('NotSupportedError: no audio device');
      const context = fakeContext({ failClose: options.failClose ?? false });
      contexts.push(context);
      return context;
    },
    canStart: () => allowed,
    now: () => Date.now(),
    onLog: (level, message) => logs.push(`${level}: ${message}`),
  });
  return {
    warmup,
    contexts,
    logs,
    allow: () => {
      allowed = true;
    },
  };
}

describe('createAudioWarmup', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('opens nothing until a meeting page holds it', () => {
    const { contexts } = setup();
    expect(contexts).toHaveLength(0);
  });

  it('keeps one context open while held, so a recording joins a graph that already runs', () => {
    const { warmup, contexts } = setup();
    warmup.hold(true);
    warmup.hold(true);
    expect(contexts).toHaveLength(1);
    expect(contexts[0]?.closeCalls).toBe(0);
  });

  it('logs once how long the graph took to run', () => {
    const { warmup, contexts, logs } = setup();
    warmup.hold(true);
    vi.advanceTimersByTime(1_500);
    contexts[0]?.become('running');
    contexts[0]?.become('suspended');
    contexts[0]?.become('running');
    expect(logs).toEqual(['info: audio warm-up: the audio graph runs after 1500 ms']);
  });

  it('opens nothing while the browser would block it, and opens it once allowed', () => {
    // A context created before the page may play audio stays suspended and warns in the
    // page's console: wait for a gesture or for the page to capture the microphone.
    const { warmup, contexts, logs, allow } = setup({ allowed: false });
    warmup.hold(true);
    warmup.hold(true);
    expect(contexts).toHaveLength(0);
    expect(logs).toEqual([
      'info: audio warm-up: waiting until the page may play audio (a click, or the microphone in use)',
    ]);
    allow();
    warmup.hold(true);
    expect(contexts).toHaveLength(1);
  });

  it('closes the context when the page is no longer a meeting, and opens a new one for the next', () => {
    const { warmup, contexts } = setup();
    warmup.hold(true);
    warmup.hold(false);
    warmup.hold(false);
    expect(contexts[0]?.closeCalls).toBe(1);
    warmup.hold(true);
    expect(contexts).toHaveLength(2);
  });

  it('ignores a context that fails to close', async () => {
    const { warmup, contexts } = setup({ failClose: true });
    warmup.hold(true);
    warmup.hold(false);
    await vi.runAllTimersAsync();
    expect(contexts[0]?.state).toBe('closed');
  });

  it('logs a context that cannot be created once, and tries again for the next meeting', () => {
    const { warmup, logs } = setup({ failCreate: true });
    warmup.hold(true);
    warmup.hold(true);
    expect(logs).toEqual([
      'warn: audio warm-up failed: Error: NotSupportedError: no audio device; a recording starts the audio graph itself',
    ]);
    warmup.hold(false);
    warmup.hold(true);
    expect(logs).toHaveLength(2);
  });
});
