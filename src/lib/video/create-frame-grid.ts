/**
 * Where each video frame goes on the track's frame grid. The WebM muxer rounds every timestamp of
 * a video track with a frame rate to the nearest multiple of 1 / rate (a slot), so two frames
 * less than a slot apart would share one timestamp, which players may drop or reorder and ffmpeg
 * reports as "non monotonically increasing dts". Frames come that close because a frame is
 * stamped once it is drawn: a draw that waits for snapshots followed by a quick one, the clock
 * standing still across a pause, a correction of the audio clock.
 *
 * A frame goes to the slot of the moment it was drawn, or, when an earlier frame took that slot,
 * to the next free one: every frame keeps a timestamp of its own, already on the grid, so the
 * muxer's rounding moves none. A frame is then at most one slot late; the following ones return
 * to their own slots as soon as the clock is a slot further, which the frame clock's interval
 * (never shorter than a slot at the rates it runs) and its timers' lateness bring about. Only a
 * clock that ticks faster than the grid could keep frames late and push them ever later; a tick
 * whose slot is behind the last frame's draws nothing (`isAhead`), so the video never drifts
 * from the audio.
 */

export interface FrameGrid {
  /** Whether the last frame took a slot after the slot of `seconds`: a tick then draws nothing. */
  isAhead(seconds: number): boolean;
  /** The timestamp (s) of a frame drawn at `seconds`: the slot of that moment or the next free one. */
  place(seconds: number): number;
}

export function createFrameGrid(fps: number): FrameGrid {
  let last = -1;
  const slotOf = (seconds: number): number => Math.round(seconds * fps);
  return {
    isAhead: (seconds) => slotOf(seconds) < last,
    place(seconds) {
      last = Math.max(slotOf(seconds), last + 1);
      return last / fps;
    },
  };
}
