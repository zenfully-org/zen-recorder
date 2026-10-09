/**
 * Minimal MediaStreamTrack double: enabled/readyState/muted/label, clone, stop, 'ended', 'mute' and
 * 'unmute' events.
 */

export interface FakeMediaStreamTrack extends MediaStreamTrack {
  clones: FakeMediaStreamTrack[];
  clone(): FakeMediaStreamTrack;
  /** Simulate the remote side ending the track. */
  end(): void;
  /** Change readyState without firing events (MediaStreamTrack's is read-only). */
  setReadyState(state: MediaStreamTrackState): void;
  /**
   * Media starts or stops arriving: `muted` changes and 'mute' or 'unmute' fires, as Firefox does
   * for a received track (muted until its first packet). Nothing fires when nothing changes.
   */
  setMuted(muted: boolean): void;
}

let counter = 0;

export function createFakeMediaStreamTrack(
  options: { kind?: 'audio' | 'video'; label?: string; id?: string; muted?: boolean } = {},
): FakeMediaStreamTrack {
  const target = new EventTarget() as FakeMediaStreamTrack;
  const mutable = target as {
    -readonly [K in keyof FakeMediaStreamTrack]: FakeMediaStreamTrack[K];
  };
  mutable.id = options.id ?? `track-${++counter}`;
  mutable.kind = options.kind ?? 'audio';
  mutable.label = options.label ?? 'Fake Microphone';
  mutable.enabled = true;
  mutable.readyState = 'live';
  mutable.muted = options.muted ?? false;
  mutable.clones = [];
  mutable.clone = () => {
    const clone = createFakeMediaStreamTrack({
      kind: options.kind ?? 'audio',
      label: mutable.label,
    });
    clone.enabled = mutable.enabled;
    mutable.clones.push(clone);
    return clone;
  };
  mutable.stop = () => {
    mutable.readyState = 'ended';
  };
  mutable.setReadyState = (state) => {
    mutable.readyState = state;
  };
  mutable.setMuted = (muted) => {
    if (mutable.muted === muted) return;
    mutable.muted = muted;
    target.dispatchEvent(new Event(muted ? 'mute' : 'unmute'));
  };
  mutable.end = () => {
    mutable.readyState = 'ended';
    target.dispatchEvent(new Event('ended'));
  };
  return target;
}
