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
  const pc = new EventTarget() as FakeRtcPeerConnection;
  pc.connectionState = 'new';
  pc.iceConnectionState = 'new';
  pc.receivers = [];
  pc.getReceivers = () => [...pc.receivers];
  pc.close = () => {
    pc.connectionState = 'closed';
    pc.iceConnectionState = 'closed';
    pc.dispatchEvent(new Event('connectionstatechange'));
  };
  pc.emitTrack = (track) => {
    pc.receivers.push({ track });
    const event = new Event('track') as Event & { track: FakeMediaStreamTrack };
    event.track = track;
    pc.dispatchEvent(event);
  };
  pc.setConnectionState = (state) => {
    pc.connectionState = state;
    pc.dispatchEvent(new Event('connectionstatechange'));
  };
  pc.setIceConnectionState = (state) => {
    pc.iceConnectionState = state;
    pc.dispatchEvent(new Event('iceconnectionstatechange'));
  };
  return pc;
}
