/**
 * Decides which microphone the recorder mirrors: the newest track the page opened and has not
 * stopped. Pages stop tracks they no longer need (Teams' permission probe on its pre-join screen,
 * Zoom's microphone test next to the call's own microphone), and `MediaStreamTrack.stop()` fires
 * no `ended` event, so the tracks are polled as well. Only a change of the current microphone is
 * reported: a newer one, an older one that is still open, or none.
 */

export interface MicWatcher {
  /** A microphone track the page opened (the `getUserMedia` hook reports each one). */
  add(track: MediaStreamTrack): void;
  /** The microphone to record as of the last check; null while the page holds none open. */
  current(): MediaStreamTrack | null;
  /** Checks the tracks now; a check also runs every `intervalMs` and when a track ends. */
  check(): void;
  dispose(): void;
}

export function createMicWatcher<TimerId>(options: {
  setInterval: (handler: () => void, ms: number) => TimerId;
  clearInterval: (id: TimerId) => void;
  onChange: (track: MediaStreamTrack | null) => void;
  intervalMs?: number;
}): MicWatcher {
  /** The tracks the page opened and had not stopped at the last check, oldest first. */
  let tracks: MediaStreamTrack[] = [];
  let current: MediaStreamTrack | null = null;
  const check = (): void => {
    tracks = tracks.filter((track) => track.readyState === 'live');
    const newest = tracks.at(-1) ?? null;
    if (newest === current) return;
    current = newest;
    options.onChange(newest);
  };
  const timer = options.setInterval(check, options.intervalMs ?? 250);
  return {
    add(track) {
      tracks.push(track);
      track.addEventListener('ended', check, { once: true });
      check();
    },
    current: () => current,
    check,
    dispose() {
      options.clearInterval(timer);
      tracks = [];
      current = null;
    },
  };
}
