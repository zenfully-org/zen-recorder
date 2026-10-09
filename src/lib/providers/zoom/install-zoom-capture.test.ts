import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CaptureListener } from '@/lib/providers/types';
import { createFakeMediaCaptureWindow } from '@/test/fakes/create-fake-media-capture-window';
import { createFakeMediaStreamTrack } from '@/test/fakes/create-fake-media-stream-track';
import type { FakeRtcPeerConnection } from '@/test/fakes/create-fake-rtc-peer-connection';
import { createFakeZoomPage } from '@/test/fakes/create-fake-zoom-page';
import { installZoomCapture } from './install-zoom-capture';

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

/** What the client does when the user leaves: `close()`, which fires no event on the closing side. */
function closeSilently(pc: FakeRtcPeerConnection): void {
  pc.connectionState = 'closed';
  pc.iceConnectionState = 'closed';
}

/** The user confirms leaving: a click on "Leave Meeting" / "End Meeting for All". */
function confirmLeave(): void {
  const page = createFakeZoomPage(document);
  page.showMeeting();
  page.showLeaveOptions().click();
}

describe('installZoomCapture', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    document.body.replaceChildren();
  });
  afterEach(() => vi.useRealTimers());

  it('starts empty and disconnected', () => {
    const page = createFakeMediaCaptureWindow();
    const capture = installZoomCapture(page.win, createListener().listener);
    expect(capture.remoteAudioTracks()).toEqual([]);
    expect(capture.anyConnected()).toBe(false);
    expect(capture.connectionCount()).toBe(0);
    expect(capture.userLeft()).toBe(false);
    capture.uninstall();
  });

  it('takes the remote audio from the element the client plays it through', () => {
    const page = createFakeMediaCaptureWindow();
    const { listener, events } = createListener();
    const capture = installZoomCapture(page.win, listener);
    // The client's peer connections only carry data channels: no remote track ever arrives.
    page.openConnection().setConnectionState('connected');
    const voices = createFakeMediaStreamTrack({ id: 'worklet-output' });
    page.createAudio().srcObject = new MediaStream([voices]);
    vi.advanceTimersByTime(500);
    expect(capture.remoteAudioTracks()).toEqual([voices]);
    expect(capture.connectionCount()).toBe(2);
    expect(events).toContain('added:worklet-output');
    capture.uninstall();
  });

  it('still reports a remote track that does arrive over a peer connection', () => {
    const page = createFakeMediaCaptureWindow();
    const { listener, events } = createListener();
    const capture = installZoomCapture(page.win, listener);
    const voice = createFakeMediaStreamTrack({ id: 'rtc-voice' });
    page.openConnection().emitTrack(voice);
    expect(capture.remoteAudioTracks()).toEqual([voice]);
    voice.end();
    expect(events).toEqual(['connections', 'added:rtc-voice', 'ended:rtc-voice']);
    capture.uninstall();
  });

  it('reports the microphone the page acquires', async () => {
    const page = createFakeMediaCaptureWindow();
    const { listener, events } = createListener();
    const capture = installZoomCapture(page.win, listener);
    await page.requestMic();
    await vi.advanceTimersByTimeAsync(0);
    expect(events).toEqual(['mic:Fake Microphone']);
    capture.uninstall();
  });

  it('notices that the client closed its peer connections, which fires no event', () => {
    const page = createFakeMediaCaptureWindow();
    const { listener, events } = createListener();
    const capture = installZoomCapture(page.win, listener, 100);
    const pc = page.openConnection();
    pc.setConnectionState('connected');
    vi.advanceTimersByTime(100);
    expect(capture.anyConnected()).toBe(true);
    events.length = 0;
    closeSilently(pc);
    vi.advanceTimersByTime(100);
    expect(events).toEqual(['connections']);
    expect(capture.anyConnected()).toBe(false);
    // The WebRTC hook forgets the connection at its own 250 ms read; then nothing per poll.
    vi.advanceTimersByTime(1000);
    expect(events).toEqual(['connections', 'connections']);
    capture.uninstall();
  });

  it('does not take a reconnect for the end of the call', () => {
    // The client drops every connection and opens new ones when the network hiccups.
    const page = createFakeMediaCaptureWindow();
    const capture = installZoomCapture(page.win, createListener().listener, 100);
    const pc = page.openConnection();
    pc.setConnectionState('connected');
    vi.advanceTimersByTime(100);
    closeSilently(pc);
    vi.advanceTimersByTime(100);
    expect(capture.userLeft()).toBe(false);
    page.openConnection().setConnectionState('connected');
    vi.advanceTimersByTime(100);
    expect(capture.anyConnected()).toBe(true);
    expect(capture.userLeft()).toBe(false);
    capture.uninstall();
  });

  it('takes a confirmed leave for the end of the call once the connections are closed', () => {
    const page = createFakeMediaCaptureWindow();
    const { listener, events } = createListener();
    const capture = installZoomCapture(page.win, listener, 100);
    const pc = page.openConnection();
    pc.setConnectionState('connected');
    vi.advanceTimersByTime(100);
    events.length = 0;
    confirmLeave();
    // The click alone is not it: a host may still be asked to name a new host.
    expect(capture.userLeft()).toBe(false);
    expect(events).toEqual(['connections']);
    closeSilently(pc);
    vi.advanceTimersByTime(100);
    expect(capture.userLeft()).toBe(true);
    expect(events).toEqual(['connections', 'connections']);
    capture.uninstall();
  });

  it('forgets a confirmed leave that did not end the call within five seconds', () => {
    const page = createFakeMediaCaptureWindow();
    const { listener, events } = createListener();
    const capture = installZoomCapture(page.win, listener, 100);
    const pc = page.openConnection();
    pc.setConnectionState('connected');
    vi.advanceTimersByTime(100);
    confirmLeave();
    vi.advanceTimersByTime(4900);
    events.length = 0;
    vi.advanceTimersByTime(100);
    // The window closed: whoever reads the meeting should look again.
    expect(events).toEqual(['connections']);
    closeSilently(pc);
    vi.advanceTimersByTime(100);
    expect(capture.userLeft()).toBe(false);
    capture.uninstall();
  });

  it('ignores clicks on anything but the leave confirmation', () => {
    const page = createFakeMediaCaptureWindow();
    const { listener, events } = createListener();
    const capture = installZoomCapture(page.win, listener, 100);
    const zoom = createFakeZoomPage(document);
    zoom.showMeeting();
    document.querySelector<HTMLElement>('.footer__leave-btn-container button')?.click();
    document.body.click();
    vi.advanceTimersByTime(100);
    expect(capture.userLeft()).toBe(false);
    expect(events).toEqual([]);
    capture.uninstall();
  });

  it('counts a click on the label inside the confirmation button', () => {
    const page = createFakeMediaCaptureWindow();
    const capture = installZoomCapture(page.win, createListener().listener, 100);
    const zoom = createFakeZoomPage(document);
    zoom.showMeeting();
    const label = document.createElement('span');
    zoom.showLeaveOptions().append(label);
    label.click();
    expect(capture.userLeft()).toBe(true);
    capture.uninstall();
  });

  it('counts only the peer connections once they carried the call', () => {
    const page = createFakeMediaCaptureWindow();
    const capture = installZoomCapture(page.win, createListener().listener, 100);
    const pc = page.openConnection();
    pc.setConnectionState('connected');
    // The client leaves its audio element playing a stream of the closed audio context.
    page.createAudio().srcObject = new MediaStream([createFakeMediaStreamTrack()]);
    vi.advanceTimersByTime(500);
    closeSilently(pc);
    expect(capture.anyConnected()).toBe(false);
    capture.uninstall();
  });

  it('counts the audio the client plays while no peer connection ever carried the call', () => {
    const page = createFakeMediaCaptureWindow();
    const capture = installZoomCapture(page.win, createListener().listener, 100);
    page.openConnection();
    page.createAudio().srcObject = new MediaStream([createFakeMediaStreamTrack()]);
    vi.advanceTimersByTime(500);
    expect(capture.anyConnected()).toBe(true);
    capture.uninstall();
  });

  it('works where WebRTC is switched off: the client then runs over WebSockets', async () => {
    const page = createFakeMediaCaptureWindow();
    Object.assign(page.win, { RTCPeerConnection: undefined });
    const originalGetUserMedia = page.win.navigator.mediaDevices.getUserMedia;
    const { listener, events } = createListener();
    const capture = installZoomCapture(page.win, listener, 100);
    expect(capture.anyConnected()).toBe(false);
    expect(capture.connectionCount()).toBe(0);
    await page.requestMic();
    await vi.advanceTimersByTimeAsync(0);
    const voices = createFakeMediaStreamTrack({ id: 'worklet-output' });
    page.createAudio().srcObject = new MediaStream([voices]);
    vi.advanceTimersByTime(500);
    expect(events).toEqual(['mic:Fake Microphone', 'added:worklet-output', 'connections']);
    expect(capture.remoteAudioTracks()).toEqual([voices]);
    // The audio it plays is the only sign of the call. Nothing closes when the user leaves, so the
    // confirmed leave alone ends the call there, for as long as the page is still around.
    expect(capture.anyConnected()).toBe(true);
    expect(capture.userLeft()).toBe(false);
    confirmLeave();
    expect(capture.userLeft()).toBe(true);
    expect(events.at(-1)).toBe('connections');
    vi.advanceTimersByTime(5000);
    expect(capture.userLeft()).toBe(false);
    capture.uninstall();
    expect(page.win.navigator.mediaDevices.getUserMedia).toBe(originalGetUserMedia);
  });

  it('restores every patched global and stops watching on uninstall', async () => {
    const page = createFakeMediaCaptureWindow();
    const originalRtc = page.win.RTCPeerConnection;
    const originalGetUserMedia = page.win.navigator.mediaDevices.getUserMedia;
    const accessor = () =>
      Object.getOwnPropertyDescriptor(page.win.HTMLMediaElement.prototype, 'srcObject')?.set;
    const originalAccessor = accessor();
    const { listener, events } = createListener();
    const capture = installZoomCapture(page.win, listener, 100);
    expect(page.win.RTCPeerConnection).not.toBe(originalRtc);
    expect(accessor()).not.toBe(originalAccessor);
    capture.uninstall();
    expect(page.win.RTCPeerConnection).toBe(originalRtc);
    expect(page.win.navigator.mediaDevices.getUserMedia).toBe(originalGetUserMedia);
    expect(accessor()).toBe(originalAccessor);
    page.openConnection();
    await page.requestMic();
    page.createAudio().srcObject = new MediaStream([createFakeMediaStreamTrack()]);
    confirmLeave();
    await vi.advanceTimersByTimeAsync(1000);
    expect(events).toEqual([]);
    expect(capture.userLeft()).toBe(false);
  });
});
