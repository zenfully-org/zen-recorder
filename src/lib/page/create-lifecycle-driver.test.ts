import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LifecycleConfig, LifecycleEvent } from '@/lib/page/reduce-lifecycle';
import { createLifecycleDriver } from './create-lifecycle-driver';

const GRACE_MS = 5000;
const CONFIG: LifecycleConfig = {
  autoRecord: true,
  startRule: 'firstRemote',
  deadConnectionGraceMs: GRACE_MS,
  maxEncoderRestarts: 3,
  encoderFailureWindowMs: 60_000,
};

/** A meeting the user is in, with someone else; `anyConnected` says whether the call is up. */
const inCall = (anyConnected: boolean, remoteAudioTracks = 1): LifecycleEvent => ({
  type: 'inputs',
  inputs: { isMeeting: true, anyConnected, remoteAudioTracks, admitted: true },
  now: Date.now(),
});

function setup(clock: () => number = () => Date.now()) {
  const effects: string[] = [];
  const timeouts: number[] = [];
  const driver = createLifecycleDriver({
    win: {
      setTimeout: (handler, ms) => {
        timeouts.push(ms);
        return window.setTimeout(handler, ms);
      },
      clearTimeout: (id) => window.clearTimeout(id),
    },
    now: clock,
    config: () => CONFIG,
    apply: (list) => {
      for (const effect of list) {
        effects.push(effect.type === 'stopRecording' ? `stop:${effect.reason}` : effect.type);
      }
    },
  });
  return { driver, effects, timeouts };
}

describe('createLifecycleDriver', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('feeds events to the reducer and hands its effects on', () => {
    const { driver, effects } = setup();
    expect(driver.state()).toBeUndefined();
    driver.dispatch(inCall(true));
    expect(effects).toEqual(['startRecording']);
    expect(driver.state()?.status).toBe('recording');
  });

  it('stops a recording whose connections are all gone at the end of the grace, with no tick', () => {
    const { driver, effects, timeouts } = setup();
    driver.dispatch(inCall(true));
    vi.advanceTimersByTime(1000);
    driver.dispatch(inCall(false));
    vi.advanceTimersByTime(GRACE_MS - 1);
    expect(effects).toEqual(['startRecording']);
    vi.advanceTimersByTime(1);
    expect(effects).toEqual(['startRecording', 'stop:connections-lost']);
    expect(driver.state()?.status).toBe('stopping');
    expect(timeouts).toEqual([GRACE_MS]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('stops a paused recording the same way', () => {
    const { driver, effects } = setup();
    driver.dispatch(inCall(true));
    driver.dispatch({ type: 'command', command: 'pause', now: Date.now() });
    driver.dispatch(inCall(false));
    vi.advanceTimersByTime(GRACE_MS);
    expect(effects).toEqual(['startRecording', 'pauseRecording', 'stop:connections-lost']);
  });

  it('arms one wake per deadline, however many events come in between', () => {
    const { driver, effects, timeouts } = setup();
    driver.dispatch(inCall(true));
    driver.dispatch(inCall(false));
    for (let second = 1; second < 5; second++) {
      vi.advanceTimersByTime(1000);
      driver.dispatch(inCall(false, second + 1));
      driver.dispatch({ type: 'tick', now: Date.now() });
    }
    vi.advanceTimersByTime(1000);
    expect(effects).toEqual(['startRecording', 'stop:connections-lost']);
    expect(timeouts).toEqual([GRACE_MS]);
  });

  it('wakes nothing once a connection is back within the grace', () => {
    const { driver, effects } = setup();
    driver.dispatch(inCall(true));
    driver.dispatch(inCall(false));
    vi.advanceTimersByTime(3000);
    driver.dispatch(inCall(true));
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(10_000);
    expect(effects).toEqual(['startRecording']);
  });

  it('wakes nothing outside a recording, or for a recording that never had a connection', () => {
    const { driver, effects } = setup();
    driver.dispatch({
      type: 'inputs',
      inputs: { isMeeting: false, anyConnected: false, remoteAudioTracks: 0, admitted: false },
      now: Date.now(),
    });
    driver.dispatch(inCall(false));
    // Recorded by hand while alone: the connection-loss rule leaves it alone.
    driver.dispatch({ type: 'command', command: 'start', now: Date.now() });
    expect(driver.state()?.status).toBe('recording');
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(10_000);
    expect(effects).toEqual(['startRecording']);
  });

  it('waits for the rest when its timer fires before the clock reached the deadline', () => {
    // The timer runs on the browser's monotonic clock, `now` on the wall clock, which may lag.
    let lag = 0;
    const { driver, effects, timeouts } = setup(() => Date.now() - lag);
    driver.dispatch(inCall(true));
    driver.dispatch(inCall(false));
    lag = 2;
    vi.advanceTimersByTime(GRACE_MS);
    expect(effects).toEqual(['startRecording']);
    vi.advanceTimersByTime(2);
    expect(effects).toEqual(['startRecording', 'stop:connections-lost']);
    expect(timeouts).toEqual([GRACE_MS, 2]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('cancels a pending wake on dispose', () => {
    const { driver, effects } = setup();
    driver.dispatch(inCall(true));
    driver.dispatch(inCall(false));
    driver.dispose();
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(10_000);
    expect(effects).toEqual(['startRecording']);
  });
});
