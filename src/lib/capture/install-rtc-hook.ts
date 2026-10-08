/**
 * Patches `RTCPeerConnection` in the page so we learn about every peer connection Meet creates and
 * every remote audio track it receives. A Proxy keeps prototype, statics and `toString()` intact.
 * Must run at `document_start`, before Meet's bundle.
 */

export interface RtcHookListener {
  remoteAudioTrackAdded(track: MediaStreamTrack, pc: RTCPeerConnection): void;
  remoteAudioTrackEnded(track: MediaStreamTrack): void;
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
  const remoteAudioTracks = new Map<string, MediaStreamTrack>();

  const addTrack = (track: MediaStreamTrack, pc: RTCPeerConnection): void => {
    if (track.kind !== 'audio' || track.readyState === 'ended') return;
    if (remoteAudioTracks.has(track.id)) return;
    remoteAudioTracks.set(track.id, track);
    track.addEventListener(
      'ended',
      () => {
        if (remoteAudioTracks.delete(track.id)) listener.remoteAudioTrackEnded(track);
      },
      { once: true },
    );
    listener.remoteAudioTrackAdded(track, pc);
  };

  const register = (pc: RTCPeerConnection): void => {
    connections.add(pc);
    pc.addEventListener('track', (event) => addTrack(event.track, pc));
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
      for (const receiver of pc.getReceivers()) addTrack(receiver.track, pc);
    }
    for (const [id, track] of remoteAudioTracks) {
      if (track.readyState === 'ended') {
        remoteAudioTracks.delete(id);
        listener.remoteAudioTrackEnded(track);
      }
    }
  };
  const timer = win.setInterval(rescan, rescanIntervalMs);

  return {
    connections,
    remoteAudioTracks,
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
