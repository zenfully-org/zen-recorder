/**
 * Patches `RTCPeerConnection` in the page so we learn about every peer connection Meet creates and
 * every remote audio track it receives. A Proxy keeps prototype, statics and `toString()` intact.
 * Must run at `document_start`, before Meet's bundle. A remote audio track counts once audio
 * arrives on it (`createRemoteAudioTracks`).
 */
import {
  createRemoteAudioTracks,
  type RemoteAudioTrackListener,
} from '@/lib/capture/create-remote-audio-tracks';

export interface RtcHookListener extends RemoteAudioTrackListener<RTCPeerConnection> {
  connectionsChanged(): void;
}

export interface RtcRegistry {
  readonly connections: ReadonlySet<RTCPeerConnection>;
  readonly remoteAudioTracks: ReadonlyMap<string, MediaStreamTrack>;
  /** True when at least one connection is (ICE) connected. */
  anyConnected(): boolean;
  /** Re-scan receivers on every connection; catches tracks that never fired a `track` event. */
  rescan(): void;
  uninstall(): void;
}

const CONNECTED_STATES = new Set<RTCPeerConnectionState>(['connected']);
const ICE_CONNECTED_STATES = new Set<RTCIceConnectionState>(['connected', 'completed']);

export function installRtcHook(
  win: Window & typeof globalThis,
  listener: RtcHookListener,
  rescanIntervalMs = 3000,
): RtcRegistry {
  const Original = win.RTCPeerConnection;
  const connections = new Set<RTCPeerConnection>();
  const remoteAudio = createRemoteAudioTracks(listener);

  const register = (pc: RTCPeerConnection): void => {
    connections.add(pc);
    pc.addEventListener('track', (event) => remoteAudio.add(event.track, pc));
    const onState = () => {
      if (pc.connectionState === 'closed') connections.delete(pc);
      listener.connectionsChanged();
    };
    pc.addEventListener('connectionstatechange', onState);
    pc.addEventListener('iceconnectionstatechange', onState);
    listener.connectionsChanged();
  };

  const Patched = new Proxy(Original, {
    construct(target, args, newTarget) {
      const pc: RTCPeerConnection = Reflect.construct(target, args, newTarget);
      register(pc);
      return pc;
    },
  });
  win.RTCPeerConnection = Patched;

  const rescan = (): void => {
    for (const pc of connections) {
      if (pc.connectionState === 'closed') {
        connections.delete(pc);
        continue;
      }
      for (const receiver of pc.getReceivers()) remoteAudio.add(receiver.track, pc);
    }
    remoteAudio.prune();
  };
  const timer = win.setInterval(rescan, rescanIntervalMs);

  return {
    connections,
    remoteAudioTracks: remoteAudio.tracks,
    anyConnected: () => {
      for (const pc of connections) {
        if (
          CONNECTED_STATES.has(pc.connectionState) ||
          ICE_CONNECTED_STATES.has(pc.iceConnectionState)
        ) {
          return true;
        }
      }
      return false;
    },
    rescan,
    uninstall: () => {
      win.clearInterval(timer);
      if (win.RTCPeerConnection === Patched) win.RTCPeerConnection = Original;
    },
  };
}
