import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeMediaStreamTrack } from '@/test/fakes/create-fake-media-stream-track';
import {
  createFakeRtcPeerConnection,
  type FakeRtcPeerConnection,
} from '@/test/fakes/create-fake-rtc-peer-connection';
import { installRtcHook, type RtcHookListener } from './install-rtc-hook';

type Win = Window & typeof globalThis;

function createWindow(): {
  win: Win;
  Original: typeof RTCPeerConnection;
  created: FakeRtcPeerConnection[];
} {
  const created: FakeRtcPeerConnection[] = [];
  function Original(this: unknown) {
    const pc = createFakeRtcPeerConnection();
    created.push(pc);
    return pc;
  }
  Original.generateCertificate = () => Promise.resolve({});
  const win = {
    RTCPeerConnection: Original as unknown as typeof RTCPeerConnection,
    setInterval: globalThis.setInterval.bind(globalThis),
    clearInterval: globalThis.clearInterval.bind(globalThis),
  } as unknown as Win;
  return { win, Original: Original as unknown as typeof RTCPeerConnection, created };
}

function createListener(): RtcHookListener & { added: string[]; ended: string[]; changes: number } {
  const listener = {
    added: [] as string[],
    ended: [] as string[],
    changes: 0,
    remoteAudioTrackAdded: (track: MediaStreamTrack) => listener.added.push(track.id),
    remoteAudioTrackEnded: (track: MediaStreamTrack) => listener.ended.push(track.id),
    connectionsChanged: () => listener.changes++,
  };
  return listener;
}

describe('installRtcHook', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('replaces the constructor with a proxy that keeps statics and restores it on uninstall', () => {
    const { win, Original } = createWindow();
    const registry = installRtcHook(win, createListener());
    expect(win.RTCPeerConnection).not.toBe(Original);
    expect(
      typeof (win.RTCPeerConnection as unknown as { generateCertificate: unknown })
        .generateCertificate,
    ).toBe('function');
    registry.uninstall();
    expect(win.RTCPeerConnection).toBe(Original);
  });

  it('does not restore a constructor that the page replaced after us', () => {
    const { win } = createWindow();
    const registry = installRtcHook(win, createListener());
    const other = (() => {}) as unknown as typeof RTCPeerConnection;
    win.RTCPeerConnection = other;
    registry.uninstall();
    expect(win.RTCPeerConnection).toBe(other);
  });

  it('registers connections created through the patched constructor', () => {
    const { win } = createWindow();
    const listener = createListener();
    const registry = installRtcHook(win, listener);
    new win.RTCPeerConnection();
    expect(registry.connections.size).toBe(1);
    expect(listener.changes).toBe(1);
  });

  it('collects remote audio tracks from track events, ignoring video and ended tracks', () => {
    const { win, created } = createWindow();
    const listener = createListener();
    const registry = installRtcHook(win, listener);
    new win.RTCPeerConnection();
    const pc = created[0];
    if (!pc) throw new Error('no pc');
    const audio = createFakeMediaStreamTrack({ id: 'a1' });
    const video = createFakeMediaStreamTrack({ id: 'v1', kind: 'video' });
    const ended = createFakeMediaStreamTrack({ id: 'e1' });
    ended.setReadyState('ended');
    pc.emitTrack(audio);
    pc.emitTrack(audio);
    pc.emitTrack(video);
    pc.emitTrack(ended);
    expect(listener.added).toEqual(['a1']);
    expect([...registry.remoteAudioTracks.keys()]).toEqual(['a1']);
  });

  it('drops a track when it ends', () => {
    const { win, created } = createWindow();
    const listener = createListener();
    const registry = installRtcHook(win, listener);
    new win.RTCPeerConnection();
    const track = createFakeMediaStreamTrack({ id: 'a1' });
    created[0]?.emitTrack(track);
    track.end();
    track.end();
    expect(listener.ended).toEqual(['a1']);
    expect(registry.remoteAudioTracks.size).toBe(0);
  });

  it('reports connected state from connectionState or ICE state and forgets closed connections', () => {
    const { win, created } = createWindow();
    const listener = createListener();
    const registry = installRtcHook(win, listener);
    new win.RTCPeerConnection();
    const pc = created[0];
    if (!pc) throw new Error('no pc');
    expect(registry.anyConnected()).toBe(false);
    pc.setIceConnectionState('completed');
    expect(registry.anyConnected()).toBe(true);
    pc.setIceConnectionState('disconnected');
    pc.setConnectionState('connected');
    expect(registry.anyConnected()).toBe(true);
    pc.close();
    expect(registry.connections.size).toBe(0);
    expect(registry.anyConnected()).toBe(false);
    expect(listener.changes).toBeGreaterThan(1);
  });

  it('rescans receivers periodically and prunes ended tracks and closed connections', () => {
    const { win, created } = createWindow();
    const listener = createListener();
    const registry = installRtcHook(win, listener, 1000);
    new win.RTCPeerConnection();
    new win.RTCPeerConnection();
    const [pc1, pc2] = created;
    if (!pc1 || !pc2) throw new Error('no pcs');
    const silent = createFakeMediaStreamTrack({ id: 'silent' });
    pc1.receivers.push({ track: silent });
    pc2.connectionState = 'closed';
    vi.advanceTimersByTime(1000);
    expect(listener.added).toEqual(['silent']);
    expect(registry.connections.size).toBe(1);
    silent.setReadyState('ended');
    registry.rescan();
    expect(listener.ended).toEqual(['silent']);
    expect(registry.remoteAudioTracks.size).toBe(0);
    // A late 'ended' event for a track the rescan already pruned is not reported twice.
    silent.end();
    expect(listener.ended).toEqual(['silent']);
    registry.uninstall();
    vi.advanceTimersByTime(5000);
    expect(listener.added).toEqual(['silent']);
  });
});

describe('installRtcHook, remote tracks without audio yet', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  // Firefox gives a received track no audio and keeps it muted until its first packet arrives;
  // Meet negotiates a few audio slots per call, and their tracks exist before anyone fills them.
  function joinWithEmptySlots() {
    const { win, created } = createWindow();
    const listener = createListener();
    const registry = installRtcHook(win, listener, 1000);
    new win.RTCPeerConnection();
    const pc = created[0];
    if (!pc) throw new Error('no pc');
    return { listener, registry, pc };
  }

  it('counts a muted remote audio track only once its first audio arrives', () => {
    const { listener, registry, pc } = joinWithEmptySlots();
    const slot = createFakeMediaStreamTrack({ id: 'slot', muted: true });
    pc.emitTrack(slot);
    pc.emitTrack(slot);
    vi.advanceTimersByTime(3000);
    expect(listener.added).toEqual([]);
    expect(registry.remoteAudioTracks.size).toBe(0);
    slot.setMuted(false);
    vi.advanceTimersByTime(3000);
    expect(listener.added).toEqual(['slot']);
    expect([...registry.remoteAudioTracks.keys()]).toEqual(['slot']);
  });

  it('does not count the muted receivers the rescan finds', () => {
    const { listener, registry, pc } = joinWithEmptySlots();
    const slots = ['s1', 's2', 's3'].map((id) => createFakeMediaStreamTrack({ id, muted: true }));
    for (const track of slots) pc.receivers.push({ track });
    vi.advanceTimersByTime(3000);
    expect(registry.remoteAudioTracks.size).toBe(0);
    slots[1]?.setMuted(false);
    expect(listener.added).toEqual(['s2']);
  });
});
