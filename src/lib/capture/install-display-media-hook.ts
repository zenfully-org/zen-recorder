/**
 * Wraps `navigator.mediaDevices.getDisplayMedia` so the recorder knows when the user shares a
 * screen from the meeting page, on every service: the meeting notes say when the user's own share
 * started and stopped, which no service's page shows reliably. The wrapper is a Proxy over the
 * browser's function, so the page sees the same name, length and native `toString`, and gets the
 * browser's own answer, refusals included. Installed at document_start, before the page's scripts,
 * and after the test builds' stand-in screen, which it then wraps like the browser's own.
 */

/** A shared stream, as far as the hook reads it. */
type Shared<Track> = Promise<{ getVideoTracks(): Track[] }>;

/** Where the page looks `getDisplayMedia` up. */
interface DisplayMedia<Track> {
  getDisplayMedia?: (...args: never[]) => Shared<Track>;
}

export interface DisplayMediaHookHandle {
  uninstall(): void;
}

/**
 * Reports each video track a share starts with (`onScreen`), once the browser resolved the call.
 * Null where the page has no `getDisplayMedia` (an insecure page, a browser without it).
 */
export function installDisplayMediaHook<Track>(
  mediaDevices: DisplayMedia<Track> | undefined,
  onScreen: (track: Track) => void,
): DisplayMediaHookHandle | null {
  const original = mediaDevices?.getDisplayMedia;
  if (mediaDevices === undefined || typeof original !== 'function') return null;
  const patched = new Proxy(original, {
    apply(target, thisArg, args) {
      const result: Shared<Track> = Reflect.apply(target, thisArg, args);
      result
        .then((stream) => {
          for (const track of stream.getVideoTracks()) onScreen(track);
        })
        .catch(() => {
          /* The page handles a refused share itself; there is no screen to report. */
        });
      return result;
    },
  });
  const define = (value: typeof original) =>
    Object.defineProperty(mediaDevices, 'getDisplayMedia', {
      configurable: true,
      writable: true,
      value,
    });
  define(patched);
  return {
    uninstall: () => {
      if (mediaDevices.getDisplayMedia === patched) define(original);
    },
  };
}
