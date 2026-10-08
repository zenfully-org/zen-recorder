import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeMediaStreamTrack } from '@/test/fakes/create-fake-media-stream-track';
import { createMicWatcher } from './create-mic-watcher';

function setup() {
  const changes: (string | null)[] = [];
  const watcher = createMicWatcher({
    setInterval: (handler, ms) => setInterval(handler, ms),
    clearInterval: (id) => clearInterval(id),
    onChange: (track) => changes.push(track?.label ?? null),
  });
  return { watcher, changes };
}

describe('createMicWatcher', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('has no microphone until the page opens one', () => {
    const { watcher, changes } = setup();
    expect(watcher.current()).toBeNull();
    vi.advanceTimersByTime(1000);
    expect(changes).toEqual([]);
  });

  it('takes the newest microphone the page opened', () => {
    const { watcher, changes } = setup();
    const first = createFakeMediaStreamTrack({ label: 'first' });
    const second = createFakeMediaStreamTrack({ label: 'second' });
    watcher.add(first);
    expect(watcher.current()).toBe(first);
    watcher.add(second);
    expect(watcher.current()).toBe(second);
    expect(changes).toEqual(['first', 'second']);
  });

  it('notices within 250 ms that the page stopped its microphone, which fires no event', () => {
    const { watcher, changes } = setup();
    const probe = createFakeMediaStreamTrack({ label: 'probe' });
    watcher.add(probe);
    probe.stop();
    expect(watcher.current()).toBe(probe);
    vi.advanceTimersByTime(250);
    expect(watcher.current()).toBeNull();
    expect(changes).toEqual(['probe', null]);
  });

  it('goes back to the newest microphone still open when a newer one stops', () => {
    const { watcher, changes } = setup();
    const meeting = createFakeMediaStreamTrack({ label: 'meeting' });
    const test = createFakeMediaStreamTrack({ label: 'test' });
    watcher.add(meeting);
    watcher.add(test);
    test.stop();
    vi.advanceTimersByTime(250);
    expect(watcher.current()).toBe(meeting);
    // Steady state: nothing more to report.
    vi.advanceTimersByTime(1000);
    expect(changes).toEqual(['meeting', 'test', 'meeting']);
  });

  it('goes back at once when the newest microphone ends with an event', () => {
    const { watcher, changes } = setup();
    const meeting = createFakeMediaStreamTrack({ label: 'meeting' });
    const headset = createFakeMediaStreamTrack({ label: 'headset' });
    watcher.add(meeting);
    watcher.add(headset);
    headset.end();
    expect(watcher.current()).toBe(meeting);
    expect(changes).toEqual(['meeting', 'headset', 'meeting']);
  });

  it('reports nothing when an older microphone stops', () => {
    const { watcher, changes } = setup();
    const old = createFakeMediaStreamTrack({ label: 'old' });
    const current = createFakeMediaStreamTrack({ label: 'current' });
    watcher.add(old);
    watcher.add(current);
    old.end();
    vi.advanceTimersByTime(250);
    expect(watcher.current()).toBe(current);
    expect(changes).toEqual(['old', 'current']);
  });

  it('ignores a microphone that was stopped before it was reported', () => {
    const { watcher, changes } = setup();
    const open = createFakeMediaStreamTrack({ label: 'open' });
    const stopped = createFakeMediaStreamTrack({ label: 'stopped' });
    stopped.stop();
    watcher.add(open);
    watcher.add(stopped);
    expect(watcher.current()).toBe(open);
    expect(changes).toEqual(['open']);
  });

  it('checks on demand, for a reading that cannot wait for the next poll', () => {
    const { watcher, changes } = setup();
    const probe = createFakeMediaStreamTrack({ label: 'probe' });
    watcher.add(probe);
    probe.stop();
    watcher.check();
    expect(watcher.current()).toBeNull();
    expect(changes).toEqual(['probe', null]);
  });

  it('stops watching on dispose', () => {
    const { watcher, changes } = setup();
    const mic = createFakeMediaStreamTrack({ label: 'mic' });
    watcher.add(mic);
    watcher.dispose();
    expect(vi.getTimerCount()).toBe(0);
    mic.end();
    expect(watcher.current()).toBeNull();
    expect(changes).toEqual(['mic']);
  });
});
