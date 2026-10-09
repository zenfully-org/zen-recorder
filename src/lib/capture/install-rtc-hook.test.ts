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

  it('patches nothing and never reports a connection where WebRTC is switched off', () => {
    // With `media.peerconnection.enabled` false, Firefox defines no `RTCPeerConnection` at all.
    const { win } = createWindow();
    Reflect.deleteProperty(win, 'RTCPeerConnection');
    const listener = createListener();
    const registry = installRtcHook(win, listener, 1000);
    expect('RTCPeerConnection' in win).toBe(false);
    vi.advanceTimersByTime(5000);
    registry.rescan();
    expect(registry.anyConnected()).toBe(false);
    expect(registry.connections.size).toBe(0);
    expect(registry.remoteAudioTracks.size).toBe(0);
    expect(listener.changes).toBe(0);
    registry.uninstall();
    expect('RTCPeerConnection' in win).toBe(false);
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

  it('reports connected state from connectionState or ICE state', () => {
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
    pc.setConnectionState('failed');
    expect(registry.anyConnected()).toBe(false);
    // Created, then four state changes.
    expect(listener.changes).toBe(5);
  });

  it('tells the listener within 250 ms that the page closed a connection, which fires no event', () => {
    const { win, created } = createWindow();
    const listener = createListener();
    const registry = installRtcHook(win, listener, 3000);
    new win.RTCPeerConnection();
    new win.RTCPeerConnection();
    const [closing, other] = created;
    if (!closing || !other) throw new Error('no pcs');
    closing.setConnectionState('connected');
    const before = listener.changes;
    closing.close();
    expect(registry.anyConnected()).toBe(false);
    vi.advanceTimersByTime(249);
    expect(listener.changes).toBe(before);
    vi.advanceTimersByTime(1);
    expect(listener.changes).toBe(before + 1);
    expect([...registry.connections]).toEqual([other]);
    // Told once: a connection it forgot is not reported again.
    vi.advanceTimersByTime(10_000);
    expect(listener.changes).toBe(before + 1);
    registry.uninstall();
    other.close();
    vi.advanceTimersByTime(1000);
    expect(listener.changes).toBe(before + 1);
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
