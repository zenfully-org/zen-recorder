/**
 * The capture window double (`createFakeCaptureWindow`) plus what the media-element capture
 * patches: an `HTMLMediaElement` whose prototype carries the `srcObject` accessor, as in Firefox,
 * a way to create detached `<audio>` elements the way a page does, and the test's own `document`.
 * happy-dom's own media element cannot be used: its `srcObject` setter rejects the test suite's
 * MediaStream stand-in.
 */
import {
  createFakeCaptureWindow,
  type FakeCaptureWindow,
} from '@/test/fakes/create-fake-capture-window';

export interface FakeAudioState {
  muted?: boolean;
  paused?: boolean;
  volume?: number;
}

export interface FakeMediaCaptureWindow extends FakeCaptureWindow {
  /** Acts like the page: creates an `<audio>` that is not in the document (playing, unmuted). */
  createAudio(state?: FakeAudioState): HTMLAudioElement;
  /** Every value the native `srcObject` setter received, in order. */
  assigned: (MediaProvider | null)[];
}

export interface FakeMediaCaptureWindowOptions {
  /** Leave the `srcObject` accessor off the prototype (an engine the capture cannot hook). */
  withoutAccessor?: boolean;
}

export function createFakeMediaCaptureWindow(
  options: FakeMediaCaptureWindowOptions = {},
): FakeMediaCaptureWindow {
  const page = createFakeCaptureWindow();
  const streams = new WeakMap<object, MediaProvider | null>();
  const assigned: (MediaProvider | null)[] = [];
  function FakeMediaElement() {}
  if (!options.withoutAccessor) {
    Object.defineProperty(FakeMediaElement.prototype, 'srcObject', {
      configurable: true,
      enumerable: true,
      get(this: object) {
        return streams.get(this) ?? null;
      },
      set(this: object, value: MediaProvider | null) {
        assigned.push(value);
        streams.set(this, value);
      },
    });
  }
  // The document and its element types are the test's own (happy-dom): captures that listen for
  // clicks see what the test clicks.
  Object.assign(page.win, {
    HTMLMediaElement: FakeMediaElement,
    MediaStream,
    document,
    HTMLButtonElement,
  });
  return {
    ...page,
    assigned,
    // Built from `any` on purpose: a double only has the members the code under test touches.
    createAudio: (state = {}) =>
      Object.assign(Object.create(FakeMediaElement.prototype), {
        muted: false,
        paused: false,
        volume: 1,
        ...state,
      }),
  };
}
