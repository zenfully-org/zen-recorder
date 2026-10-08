import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeMediaStreamTrack } from '@/test/fakes/create-fake-media-stream-track';
import { createMicMirror } from './create-mic-mirror';

const timers = {
  setInterval: (handler: () => void, ms: number) => setInterval(handler, ms) as unknown as number,
  clearInterval: (id: number) => clearInterval(id),
};

describe('createMicMirror', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('clones the track and exposes its label', () => {
    const original = createFakeMediaStreamTrack({ label: 'USB mic' });
    const mirror = createMicMirror(original, timers);
    expect(mirror.clone).toBe(original.clones[0]);
    expect(mirror.label).toBe('USB mic');
  });

  it('mirrors mute/unmute on the interval', () => {
    const original = createFakeMediaStreamTrack();
    const mirror = createMicMirror(original, { ...timers, intervalMs: 100 });
    original.enabled = false;
    expect(mirror.clone.enabled).toBe(true);
    vi.advanceTimersByTime(100);
    expect(mirror.clone.enabled).toBe(false);
    original.enabled = true;
    vi.advanceTimersByTime(100);
    expect(mirror.clone.enabled).toBe(true);
  });

  it('follows the mute state of the page UI when the provider can read it', () => {
    const original = createFakeMediaStreamTrack();
    let muted: boolean | null = true;
    const mirror = createMicMirror(original, { ...timers, intervalMs: 100, isMuted: () => muted });
    expect(mirror.clone.enabled).toBe(false);
    muted = false;
    vi.advanceTimersByTime(100);
    expect(mirror.clone.enabled).toBe(true);
    muted = null;
    vi.advanceTimersByTime(100);
    expect(mirror.clone.enabled).toBe(true);
    muted = false;
    original.enabled = false;
    vi.advanceTimersByTime(100);
    expect(mirror.clone.enabled).toBe(false);
  });

  it('starts muted when the original is already muted', () => {
    const original = createFakeMediaStreamTrack();
    original.enabled = false;
    expect(createMicMirror(original, timers).clone.enabled).toBe(false);
  });

  it('disables the clone when the original stopped without an event', () => {
    const original = createFakeMediaStreamTrack();
    const mirror = createMicMirror(original, timers);
    original.setReadyState('ended');
    mirror.sync();
    expect(mirror.clone.enabled).toBe(false);
  });

  it('disposes when the original ends: stops the clone, clears the timer, calls onEnded once', () => {
    const original = createFakeMediaStreamTrack();
    const onEnded = vi.fn();
    const mirror = createMicMirror(original, { ...timers, onEnded });
    original.end();
    expect(mirror.clone.readyState).toBe('ended');
    expect(onEnded).toHaveBeenCalledTimes(1);
    mirror.dispose();
    expect(onEnded).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('works without an onEnded callback', () => {
    const original = createFakeMediaStreamTrack();
    const mirror = createMicMirror(original, timers);
    expect(() => mirror.dispose()).not.toThrow();
  });
});
