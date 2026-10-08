import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CaptureListener } from '@/lib/providers/types';
import { createFakeCaptureWindow } from '@/test/fakes/create-fake-capture-window';
import { createFakeMediaStreamTrack } from '@/test/fakes/create-fake-media-stream-track';
import { installWebRtcCapture } from './install-web-rtc-capture';

function createListener() {
  const events: string[] = [];
  const listener: CaptureListener = {
    remoteAudioTrackAdded: (track) => events.push(`added:${track.id}`),
    remoteAudioTrackEnded: (track) => events.push(`ended:${track.id}`),
    connectionsChanged: () => events.push('connections'),
    micTrackAdded: (track) => events.push(`mic:${track.label}`),
  };
  return { listener, events };
}

describe('installWebRtcCapture', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('starts empty and disconnected', () => {
    const { win } = createFakeCaptureWindow();
    const capture = installWebRtcCapture(win, createListener().listener);
    expect(capture.remoteAudioTracks()).toEqual([]);
    expect(capture.anyConnected()).toBe(false);
    expect(capture.connectionCount()).toBe(0);
    capture.uninstall();
  });

  it('reports the remote audio tracks and connection state of the page', () => {
    const page = createFakeCaptureWindow();
    const { listener, events } = createListener();
    const capture = installWebRtcCapture(page.win, listener);
    const pc = page.openConnection();
    expect(capture.connectionCount()).toBe(1);
    pc.setConnectionState('connected');
    expect(capture.anyConnected()).toBe(true);
    const audio = createFakeMediaStreamTrack({ id: 'remote-1' });
    pc.emitTrack(audio);
    pc.emitTrack(createFakeMediaStreamTrack({ id: 'camera', kind: 'video' }));
    expect(capture.remoteAudioTracks()).toEqual([audio]);
    audio.end();
    expect(capture.remoteAudioTracks()).toEqual([]);
    expect(events).toEqual(['connections', 'connections', 'added:remote-1', 'ended:remote-1']);
    capture.uninstall();
  });

  it('reports the microphone the page acquires', async () => {
    const page = createFakeCaptureWindow();
    const { listener, events } = createListener();
    const capture = installWebRtcCapture(page.win, listener);
    await page.requestMic();
    await vi.advanceTimersByTimeAsync(0);
    expect(events).toEqual(['mic:Fake Microphone']);
    capture.uninstall();
  });

  it('restores the patched globals on uninstall', async () => {
    const page = createFakeCaptureWindow();
    const originalRtc = page.win.RTCPeerConnection;
    const originalGetUserMedia = page.win.navigator.mediaDevices.getUserMedia;
    const { listener, events } = createListener();
    const capture = installWebRtcCapture(page.win, listener);
    expect(page.win.RTCPeerConnection).not.toBe(originalRtc);
    expect(page.win.navigator.mediaDevices.getUserMedia).not.toBe(originalGetUserMedia);
    capture.uninstall();
    expect(page.win.RTCPeerConnection).toBe(originalRtc);
    expect(page.win.navigator.mediaDevices.getUserMedia).toBe(originalGetUserMedia);
    page.openConnection();
    await page.requestMic();
    expect(events).toEqual([]);
  });
});
