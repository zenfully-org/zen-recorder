/**
 * Keeps a cloned microphone track in sync with the original one: when the page mutes (sets
 * `enabled = false`) or stops the original, the clone follows. Clones are independent tracks, so
 * without this the recording would keep capturing while the user believes they are muted. Pages
 * that mute some other way report it through `isMuted` (the provider reads their mute button).
 * Each flip of the clone is reported (`onChange`): the meeting notes write the microphone's state.
 */

export interface MicMirror {
  readonly clone: MediaStreamTrack;
  readonly label: string;
  sync(): void;
  dispose(): void;
}

export function createMicMirror(
  original: MediaStreamTrack,
  options: {
    setInterval: (handler: () => void, ms: number) => number;
    clearInterval: (id: number) => void;
    onEnded?: () => void;
    intervalMs?: number;
    /** The page UI says the microphone is muted (true), unmuted (false) or cannot tell (null). */
    isMuted?: () => boolean | null;
    /** The clone was turned on (true) or off (false). */
    onChange?: (enabled: boolean) => void;
  },
): MicMirror {
  const clone = original.clone();
  let onEnded = options.onEnded ?? null;
  const sync = (): void => {
    const shouldBeEnabled =
      original.enabled && original.readyState === 'live' && options.isMuted?.() !== true;
    if (clone.enabled === shouldBeEnabled) return;
    clone.enabled = shouldBeEnabled;
    options.onChange?.(shouldBeEnabled);
  };
  sync();
  const timer = options.setInterval(sync, options.intervalMs ?? 250);
  const dispose = (): void => {
    options.clearInterval(timer);
    clone.stop();
    const callback = onEnded;
    onEnded = null;
    callback?.();
  };
  original.addEventListener('ended', dispose, { once: true });
  return {
    clone,
    get label() {
      return original.label;
    },
    sync,
    dispose,
  };
}
