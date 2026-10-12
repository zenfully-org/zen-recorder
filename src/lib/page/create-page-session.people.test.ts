/**
 * `createPageSession`'s part in the meeting notes' people and shares: who is in the call is read
 * once a tick while a recording runs, never as a lifecycle input, and the user's own share comes
 * from the browser, its end by the page read at the next tick.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parsePageConfig } from '@/lib/protocol/parse-page-config';
import type { MeetingPresence } from '@/lib/providers/types';
import { createFakeMeetingProvider } from '@/test/fakes/create-fake-meeting-provider';
import { setupPageSession as setup, takeEvents } from '@/test/page-session-harness';

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1_000_000);
});
afterEach(() => {
  vi.useRealTimers();
});

describe("createPageSession, the user's own share", () => {
  const speaksEvents = parsePageConfig({ eventsProtocol: 1 });

  // The page's own track.stop() fires no event: the share's state, read at the next tick, says it.
  it('writes a share the browser gave the page at once, and its stop by the page at the next tick', async () => {
    const { session, flush, bridge, fromBridge, inCall, shareScreen } = setup();
    const events = takeEvents(bridge);
    session.start();
    await fromBridge('bridge:configure', speaksEvents);
    await inCall();
    await vi.advanceTimersByTimeAsync(1_500);
    const screen = shareScreen();
    await vi.advanceTimersByTimeAsync(2_000);
    screen.stop();
    await vi.advanceTimersByTimeAsync(1_000);
    await fromBridge('bridge:command', { command: 'stop' });
    await flush();
    const shares = events.filter((event) => event.type.startsWith('share-'));
    expect(events[0]).toMatchObject({ type: 'recording-started', ownShare: false });
    expect(shares).toMatchObject([
      { type: 'share-started', by: { id: 'p1', self: true } },
      { type: 'share-stopped', by: { id: 'p1', self: true } },
    ]);
    const [started, stopped] = shares.map((event) => Number(event['atMs']));
    expect((stopped ?? 0) - (started ?? 0)).toBeGreaterThanOrEqual(2_000);
    expect((stopped ?? 0) - (started ?? 0)).toBeLessThanOrEqual(3_000);
  });
});

describe('createPageSession, who is in the call', () => {
  const speaksEvents = parsePageConfig({ eventsProtocol: 1, autoRecord: false });
  const person = (name: string) => ({ key: `id-${name}`, name, self: false });
  const call = (...names: string[]): MeetingPresence => ({
    participants: names.map(person),
    source: 'stage',
    count: names.length + 1,
    share: { kind: 'none' },
    selfMic: null,
  });

  // The notes alone read it: what the page shows of people starts, stops and pauses nothing.
  it('reads who is in the call once per tick while a recording runs or is paused, and never as a lifecycle input', async () => {
    const { provider, page } = createFakeMeetingProvider();
    page.presence = call('Ana');
    const reads = vi.spyOn(provider, 'readPresence');
    const { session, fromBridge, inCall, snapshots } = setup({ provider });
    session.start();
    await fromBridge('bridge:configure', speaksEvents);
    await inCall();
    await vi.advanceTimersByTimeAsync(3_000);
    expect(reads).not.toHaveBeenCalled();
    await fromBridge('bridge:command', { command: 'start' });
    reads.mockClear();
    await vi.advanceTimersByTimeAsync(3_000);
    await fromBridge('bridge:command', { command: 'pause' });
    await vi.advanceTimersByTimeAsync(3_000);
    expect(reads).toHaveBeenCalledTimes(6);
    const published = snapshots.length;
    page.presence = call('Ana', 'Ben', 'Chloé');
    await vi.advanceTimersByTimeAsync(3_000);
    expect(snapshots).toHaveLength(published);
    expect(session.getSnapshot().state).toBe('paused');
    await fromBridge('bridge:command', { command: 'stop' });
    reads.mockClear();
    await vi.advanceTimersByTimeAsync(3_000);
    expect(reads).not.toHaveBeenCalled();
  });
});
