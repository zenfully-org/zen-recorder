/**
 * Whether the page's next recording may have video. A video pipeline that failed keeps it off for
 * the rest of the meeting. A recording with video that filled the page's backlog limit turns it
 * off only until the extension has taken that recording (the page's snapshot no longer says
 * `audio-only`) and the running recording holds nothing unacked either, so the extension keeps up:
 * then the video comes back, once, and the rest of the meeting is recorded with it again.
 */
import type { TabSnapshot } from '@/lib/types';

export function createVideoGate(backlogFull: () => TabSnapshot['backlogFull']) {
  let off: 'failed' | 'filled' | null = null;
  return {
    allows: (): boolean => off === null,
    /** The video pipeline failed: off for the rest of the meeting. */
    fail(): void {
      off = 'failed';
    },
    /** A recording with video filled the backlog: off until the extension has taken it. */
    fill(): void {
      off ??= 'filled';
    },
    /** Another meeting: video again. */
    reset(): void {
      off = null;
    },
    /** True once, when the video may come back for the recording that runs. */
    comesBack(running: { recording: boolean; pending: number }): boolean {
      const taken = backlogFull() !== 'audio-only';
      if (off !== 'filled' || !taken || !running.recording || running.pending > 0) return false;
      off = null;
      return true;
    },
  };
}
