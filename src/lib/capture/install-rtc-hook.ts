/**
 * Patches `RTCPeerConnection` in the page so we learn about every peer connection Meet creates and
 * every remote audio track it receives. A Proxy keeps prototype, statics and `toString()` intact.
 * Must run at `document_start`, before Meet's bundle.
 *
 * Where WebRTC is switched off (`media.peerconnection.enabled` false, a common privacy setting),
 * Firefox defines no `RTCPeerConnection`: there is nothing to patch, and the registry stays empty
 * and never connected. Zoom's web client still holds a call that way, over WebSockets.
 *
 * A connection the page closes fires no event (`close()` sets the states and Firefox suppresses
 * every event after it), so the connections are read every 250 ms and the listener hears of a
 * closed one then. That is a poll, not a patch of `RTCPeerConnection.prototype.close`: every patch
 * the page session installs stays for the life of the tab, extension updates included.
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
/** How often the connections are read for one the page closed. */
const CLOSED_POLL_MS = 250;

const NO_WEBRTC: RtcRegistry = {
  connections: new Set(),
  remoteAudioTracks: new Map(),
  anyConnected: () => false,
  rescan: () => undefined,
  uninstall: () => undefined,
};

export function installRtcHook(
  win: Window & typeof globalThis,
  listener: RtcHookListener,
  rescanIntervalMs = 3000,
): RtcRegistry {
  const Original = win.RTCPeerConnection;
  if (typeof Original !== 'function') return NO_WEBRTC;
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
    const onState = () => listener.connectionsChanged();
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

  /** Forgets the connections the page closed, and tells the listener only when there were any. */
  const forgetClosed = (): void => {
    const closed = [...connections].filter((pc) => pc.connectionState === 'closed');
    for (const pc of closed) connections.delete(pc);
    if (closed.length > 0) listener.connectionsChanged();
  };

  const rescan = (): void => {
    forgetClosed();
    for (const pc of connections) {
      for (const receiver of pc.getReceivers()) addTrack(receiver.track, pc);
    }
    for (const [id, track] of remoteAudioTracks) {
      if (track.readyState === 'ended') {
        remoteAudioTracks.delete(id);
        listener.remoteAudioTrackEnded(track);
      }
    }
  };
  const timers = [
    win.setInterval(forgetClosed, CLOSED_POLL_MS),
    win.setInterval(rescan, rescanIntervalMs),
  ];

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
      for (const timer of timers) win.clearInterval(timer);
      if (win.RTCPeerConnection === Patched) win.RTCPeerConnection = Original;
    },
  };
}
