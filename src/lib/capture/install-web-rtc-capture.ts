/**
 * The WebRTC capture source: remote audio comes from the page's own `RTCPeerConnection`s and the
 * microphone from its `getUserMedia` calls. This is all Google Meet needs; providers with other
 * audio paths combine it with their own source (`combineCaptures`).
 */
import { installGetUserMediaHook } from '@/lib/capture/install-get-user-media-hook';
import { installRtcHook } from '@/lib/capture/install-rtc-hook';
import type { CaptureListener, MediaCapture } from '@/lib/providers/types';

export function installWebRtcCapture(
  win: Window & typeof globalThis,
  listener: CaptureListener,
): MediaCapture {
  const rtc = installRtcHook(win, {
    remoteAudioTrackAdded: (track) => listener.remoteAudioTrackAdded(track),
    remoteAudioTrackEnded: (track) => listener.remoteAudioTrackEnded(track),
    connectionsChanged: () => listener.connectionsChanged(),
  });
  const mic = installGetUserMediaHook(win.navigator.mediaDevices, (track) =>
    listener.micTrackAdded(track),
  );
  return {
    remoteAudioTracks: () => [...rtc.remoteAudioTracks.values()],
    anyConnected: () => rtc.anyConnected(),
    connectionCount: () => rtc.connections.size,
    uninstall() {
      rtc.uninstall();
      mic.uninstall();
    },
  };
}
