/**
 * The remote audio tracks a page's peer connections receive, as the RTC hook counts them: a track
 * counts once audio arrives on it, and stops counting when it ends.
 *
 * Firefox creates a received track muted and unmutes it on its first packet, and mutes it again
 * only when the remote description stops sending on it. Meet negotiates a few audio slots per call,
 * and their tracks exist before anyone fills them: counted at once, they made a call nobody joined
 * look attended.
 */

/** `Connection` is the peer connection a track came from, passed through as it is. */
export interface RemoteAudioTrackListener<Connection> {
  remoteAudioTrackAdded(track: MediaStreamTrack, pc: Connection): void;
  remoteAudioTrackEnded(track: MediaStreamTrack): void;
}

export interface RemoteAudioTracks<Connection> {
  readonly tracks: ReadonlyMap<string, MediaStreamTrack>;
  /** A track seen on `pc`, by its 'track' event or among its receivers; seen again, nothing. */
  add(track: MediaStreamTrack, pc: Connection): void;
  /** Forgets the tracks that ended without an 'ended' event (a stopped track fires none). */
  prune(): void;
}

export function createRemoteAudioTracks<Connection>(
  listener: RemoteAudioTrackListener<Connection>,
): RemoteAudioTracks<Connection> {
  const tracks = new Map<string, MediaStreamTrack>();
  /** Tracks no audio has reached yet, waiting for their 'unmute'. */
  const silent = new Map<string, MediaStreamTrack>();

  const add = (track: MediaStreamTrack, pc: Connection): void => {
    if (track.kind !== 'audio' || track.readyState === 'ended') return;
    if (tracks.has(track.id) || silent.has(track.id)) return;
    if (track.muted) {
      silent.set(track.id, track);
      track.addEventListener(
        'unmute',
        () => {
          silent.delete(track.id);
          add(track, pc);
        },
        { once: true },
      );
      return;
    }
    tracks.set(track.id, track);
    track.addEventListener(
      'ended',
      () => {
        if (tracks.delete(track.id)) listener.remoteAudioTrackEnded(track);
      },
      { once: true },
    );
    listener.remoteAudioTrackAdded(track, pc);
  };

  return {
    tracks,
    add,
    prune: () => {
      for (const [id, track] of tracks) {
        if (track.readyState === 'ended') {
          tracks.delete(id);
          listener.remoteAudioTrackEnded(track);
        }
      }
      for (const [id, track] of silent) {
        if (track.readyState === 'ended') silent.delete(id);
      }
    },
  };
}
