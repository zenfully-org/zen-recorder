/** MediaStreamTrack double: enabled/readyState/label, clone, stop, 'ended' events. */

export interface FakeMediaStreamTrack extends MediaStreamTrack {
  clones: FakeMediaStreamTrack[];
  clone(): FakeMediaStreamTrack;
  /** Simulate the remote side ending the track. */
  end(): void;
  /** Change readyState without firing events (MediaStreamTrack's is read-only). */
  setReadyState(state: MediaStreamTrackState): void;
}

let counter = 0;

export function createFakeMediaStreamTrack(
  options: { kind?: 'audio' | 'video'; label?: string; id?: string } = {},
): FakeMediaStreamTrack {
  const events = new EventTarget();
  let readyState: MediaStreamTrackState = 'live';
  const track: FakeMediaStreamTrack = {
    id: options.id ?? `track-${++counter}`,
    kind: options.kind ?? 'audio',
    label: options.label ?? 'Fake Microphone',
    enabled: true,
    muted: false,
    contentHint: '',
    get readyState() {
      return readyState;
    },
    onended: null,
    onmute: null,
    onunmute: null,
    clones: [],
    clone() {
      const clone = createFakeMediaStreamTrack({
        kind: options.kind ?? 'audio',
        label: track.label,
      });
      clone.enabled = track.enabled;
      track.clones.push(clone);
      return clone;
    },
    stop() {
      readyState = 'ended';
    },
    setReadyState(state) {
      readyState = state;
    },
    end() {
      readyState = 'ended';
      events.dispatchEvent(new Event('ended'));
    },
    applyConstraints: async () => undefined,
    getCapabilities: () => ({}),
    getConstraints: () => ({}),
    getSettings: () => ({}),
    addEventListener: (
      type: string,
      listener: EventListenerOrEventListenerObject,
      listenerOptions?: boolean | AddEventListenerOptions,
    ) => events.addEventListener(type, listener, listenerOptions),
    removeEventListener: (
      type: string,
      listener: EventListenerOrEventListenerObject,
      listenerOptions?: boolean | EventListenerOptions,
    ) => events.removeEventListener(type, listener, listenerOptions),
    dispatchEvent: (event) => events.dispatchEvent(event),
  };
  return track;
}
