/**
 * Where a MediaRecorder recording is in its file, from the clock of the stream that feeds it, in
 * seconds (the mixer's `streamTime()`). Gecko stamps Opus packets by the frames the stream carried
 * (`dom/media/encoder/OpusTrackEncoder.cpp`), and appends nothing while the recorder is paused
 * (`dom/media/encoder/TrackEncoder.cpp`), so the file's position is the stream's time since the
 * start, minus the paused spans.
 *
 * It reads that clock only, with no wall clock of its own: `currentTime` moves in render quanta, so
 * two calls inside one see no progress, and a fallback to the wall clock there would mix two
 * clocks. The position stands still while paused, never goes back, and stays where it was at
 * `stop()`; it is 0 before `start()`.
 */

export interface AudioFileClock {
  /** Once, when the recorder starts. */
  start(): void;
  pause(): void;
  resume(): void;
  stop(): void;
  /** The position in the file now, in milliseconds. */
  mediaTimeMs(): number;
}

export function createAudioFileClock(read: () => number): AudioFileClock {
  let state: 'idle' | 'recording' | 'paused' | 'stopped' = 'idle';
  let startedAt = 0;
  let pausedAt = 0;
  let pausedSeconds = 0;
  let last = 0;

  const mediaTimeMs = (): number => {
    if (state !== 'recording') return last;
    last = Math.max(last, (read() - startedAt - pausedSeconds) * 1000);
    return last;
  };

  return {
    start() {
      startedAt = read();
      state = 'recording';
    },
    pause() {
      if (state !== 'recording') return;
      mediaTimeMs();
      pausedAt = read();
      state = 'paused';
    },
    resume() {
      if (state !== 'paused') return;
      pausedSeconds += read() - pausedAt;
      state = 'recording';
    },
    stop() {
      mediaTimeMs();
      state = 'stopped';
    },
    mediaTimeMs,
  };
}
