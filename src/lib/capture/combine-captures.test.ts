import { describe, expect, it, vi } from 'vitest';
import type { MediaCapture } from '@/lib/providers/types';
import { createFakeMediaStreamTrack } from '@/test/fakes/create-fake-media-stream-track';
import { combineCaptures } from './combine-captures';

function capture(state: {
  tracks?: MediaStreamTrack[];
  connected?: boolean;
  connections?: number;
}) {
  const uninstall = vi.fn();
  const value: MediaCapture = {
    remoteAudioTracks: () => state.tracks ?? [],
    anyConnected: () => state.connected ?? false,
    connectionCount: () => state.connections ?? 0,
    uninstall,
  };
  return { value, uninstall };
}

describe('combineCaptures', () => {
  it('is empty and disconnected without sources', () => {
    const combined = combineCaptures([]);
    expect(combined.remoteAudioTracks()).toEqual([]);
    expect(combined.anyConnected()).toBe(false);
    expect(combined.connectionCount()).toBe(0);
    expect(() => combined.uninstall()).not.toThrow();
  });

  it('merges tracks (once per id), connection state and counts', () => {
    const shared = createFakeMediaStreamTrack({ id: 'shared' });
    const a = createFakeMediaStreamTrack({ id: 'a' });
    const b = createFakeMediaStreamTrack({ id: 'b' });
    const combined = combineCaptures([
      capture({ tracks: [a, shared], connections: 2 }).value,
      capture({ tracks: [shared, b], connected: true, connections: 1 }).value,
    ]);
    expect(combined.remoteAudioTracks()).toEqual([a, shared, b]);
    expect(combined.anyConnected()).toBe(true);
    expect(combined.connectionCount()).toBe(3);
  });

  it('reads its sources live', () => {
    const state: { tracks: MediaStreamTrack[]; connected: boolean } = {
      tracks: [],
      connected: false,
    };
    const combined = combineCaptures([capture(state).value]);
    expect(combined.anyConnected()).toBe(false);
    state.connected = true;
    state.tracks = [createFakeMediaStreamTrack({ id: 'late' })];
    expect(combined.anyConnected()).toBe(true);
    expect(combined.remoteAudioTracks().map((t) => t.id)).toEqual(['late']);
  });

  it('uninstalls every source, even when one throws', () => {
    const first = capture({});
    const second = capture({});
    first.uninstall.mockImplementation(() => {
      throw new Error('already gone');
    });
    combineCaptures([first.value, second.value]).uninstall();
    expect(first.uninstall).toHaveBeenCalledTimes(1);
    expect(second.uninstall).toHaveBeenCalledTimes(1);
  });
});
