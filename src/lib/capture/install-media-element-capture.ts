/**
 * The media-element capture source: remote audio is whatever the page plays through an `<audio>` or
 * `<video>` element fed by a `MediaStream`. Services that decode audio themselves (Zoom: WASM
 * workers, an AudioWorklet and a `MediaStreamAudioDestinationNode`) have no remote WebRTC tracks;
 * the stream they hand to a media element is the only place the call's audio exists as a track.
 * The elements are often not in the document, so they cannot be found by a query: the `srcObject`
 * setter is patched instead, and the elements it saw are re-read on a timer.
 *
 * Only audible elements count (playing, not muted, volume above zero). That is what keeps the
 * recorder's own audio out: its mixer parks every track it mixes on a muted element.
 */
import type { CaptureListener, MediaCapture } from '@/lib/providers/types';

type MediaElementListener = Pick<
  CaptureListener,
  'remoteAudioTrackAdded' | 'remoteAudioTrackEnded' | 'connectionsChanged'
>;

export function installMediaElementCapture(
  win: Window & typeof globalThis,
  listener: MediaElementListener,
  rescanIntervalMs = 500,
): MediaCapture {
  const proto = win.HTMLMediaElement.prototype;
  const native = Object.getOwnPropertyDescriptor(proto, 'srcObject');
  const { get, set } = native ?? {};
  /** The live audio tracks of audible elements, as last reported. */
  const audible = new Map<string, MediaStreamTrack>();
  const view = {
    remoteAudioTracks: () => [...audible.values()],
    anyConnected: () => audible.size > 0,
    connectionCount: () => audible.size,
  };
  if (!native || !get || !set) return { ...view, uninstall: () => undefined };

  /** Elements that were given a source; dropped again once they have no stream. */
  const elements = new Set<HTMLMediaElement>();
  const patchedSet = function (this: HTMLMediaElement, value: MediaProvider | null): void {
    Reflect.apply(set, this, [value]);
    elements.add(this);
  };
  Object.defineProperty(proto, 'srcObject', { ...native, set: patchedSet });

  const scan = (): void => {
    const playing = new Map<string, MediaStreamTrack>();
    for (const element of elements) {
      const source: unknown = Reflect.apply(get, element, []);
      if (!(source instanceof win.MediaStream)) {
        elements.delete(element);
        continue;
      }
      if (element.muted || element.paused || element.volume === 0) continue;
      for (const track of source.getAudioTracks()) {
        if (track.readyState === 'live') playing.set(track.id, track);
      }
    }
    const gone = [...audible.values()].filter((track) => !playing.has(track.id));
    const fresh = [...playing.values()].filter((track) => !audible.has(track.id));
    for (const track of gone) {
      audible.delete(track.id);
      listener.remoteAudioTrackEnded(track);
    }
    for (const track of fresh) {
      audible.set(track.id, track);
      listener.remoteAudioTrackAdded(track);
    }
    if (gone.length + fresh.length > 0) listener.connectionsChanged();
  };
  const timer = win.setInterval(scan, rescanIntervalMs);

  return {
    ...view,
    uninstall() {
      win.clearInterval(timer);
      if (Object.getOwnPropertyDescriptor(proto, 'srcObject')?.set === patchedSet) {
        Object.defineProperty(proto, 'srcObject', native);
      }
    },
  };
}
