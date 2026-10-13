/** RTCPeerConnection double: receivers, connection states and a way to emit 'track' events. */
import type { FakeMediaStreamTrack } from '@/test/fakes/create-fake-media-stream-track';

export interface FakeRtcPeerConnection extends EventTarget {
  connectionState: RTCPeerConnectionState;
  iceConnectionState: RTCIceConnectionState;
  receivers: { track: FakeMediaStreamTrack }[];
  getReceivers(): { track: FakeMediaStreamTrack }[];
  close(): void;
  emitTrack(track: FakeMediaStreamTrack): void;
  setConnectionState(state: RTCPeerConnectionState): void;
  setIceConnectionState(state: RTCIceConnectionState): void;
}

export function createFakeRtcPeerConnection(): FakeRtcPeerConnection {
  const events = new EventTarget();
  const pc: FakeRtcPeerConnection = {
    connectionState: 'new',
    iceConnectionState: 'new',
    receivers: [],
    getReceivers: () => [...pc.receivers],
    // As in Firefox, `close()` changes the states at once and fires no event: Gecko's
    // `PeerConnectionImpl::Close` sets them, then `PeerConnection.sys.mjs` suppresses every event.
    close() {
      pc.connectionState = 'closed';
      pc.iceConnectionState = 'closed';
    },
    emitTrack(track) {
      pc.receivers.push({ track });
      pc.dispatchEvent(Object.assign(new Event('track'), { track }));
    },
    setConnectionState(state) {
      pc.connectionState = state;
      pc.dispatchEvent(new Event('connectionstatechange'));
    },
    setIceConnectionState(state) {
      pc.iceConnectionState = state;
      pc.dispatchEvent(new Event('iceconnectionstatechange'));
    },
    addEventListener: (type, listener, options) => events.addEventListener(type, listener, options),
    removeEventListener: (type, listener, options) =>
      events.removeEventListener(type, listener, options),
    dispatchEvent: (event) => events.dispatchEvent(event),
  };
  return pc;
}
