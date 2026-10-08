/**
 * Patches `navigator.mediaDevices.getUserMedia` so we observe the microphone track Meet itself
 * acquired. Recording a clone of that track means we use exactly the device (and the echo
 * cancellation / noise suppression settings) Meet uses, without a second permission prompt.
 */

export interface GetUserMediaHookHandle {
  uninstall(): void;
}

export function installGetUserMediaHook(
  mediaDevices: MediaDevices,
  onMicTrack: (track: MediaStreamTrack) => void,
): GetUserMediaHookHandle {
  const original = mediaDevices.getUserMedia;
  const patched = new Proxy(original, {
    apply(target, thisArg, args) {
      const result: Promise<MediaStream> = Reflect.apply(target, thisArg, args);
      result
        .then((stream) => {
          for (const track of stream.getAudioTracks()) onMicTrack(track);
        })
        .catch(() => {
          /* Meet handles its own errors; nothing to observe. */
        });
      return result;
    },
  });
  const define = (value: typeof original) =>
    Object.defineProperty(mediaDevices, 'getUserMedia', {
      configurable: true,
      writable: true,
      value,
    });
  define(patched);
  return {
    uninstall: () => {
      if (mediaDevices.getUserMedia === patched) define(original);
    },
  };
}
