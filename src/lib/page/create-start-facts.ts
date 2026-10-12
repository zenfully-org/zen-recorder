/**
 * What the start of each of a page's recordings says of it, for the meeting notes: why it started,
 * why without video, and the recording it goes on from: the page's previous one in the same
 * meeting, whatever ended it, with the wall time from that one's stop. A meeting split into files
 * (a failed encoder, a full backlog, Stop then Record, a call that dropped and came back) reads as
 * one meeting that way.
 */
import { startCauseOf } from '@/lib/page/start-cause-of';
import type { AudioOnlyReason, RecordingStartFacts, StartCause, StartTrigger } from '@/lib/types';

/** What the session knows of a recording as it starts it. */
export interface NotesStart {
  /** What made the lifecycle want it. */
  trigger: StartTrigger;
  /** The meeting it records; null outside any, where a recording goes on from nothing. */
  meetingId: string | null;
  /** Null with video. */
  audioOnlyReason: AudioOnlyReason | null;
}

/** What a start says of its recording; the page always knows why it started one. */
export type StartFacts = RecordingStartFacts & { cause: StartCause };

/** A recording of the page, for the next one to continue. */
interface Ran {
  id: string;
  meetingId: string | null;
  hasVideo: boolean;
}

export function createStartFacts() {
  /** The recording that runs, and the last one that stopped, with when its stop was stamped. */
  let running: Ran | null = null;
  let previous: (Ran & { stoppedAt: number }) | null = null;

  return {
    /** Recording `recording` starts at `atMs`: what its start says of it. */
    started(
      recording: { id: string; video: object | null },
      start: NotesStart,
      atMs: number,
    ): StartFacts {
      const { meetingId } = start;
      const same = meetingId !== null && previous?.meetingId === meetingId ? previous : null;
      const facts: StartFacts = {
        cause: startCauseOf(start.trigger, previous?.hasVideo === true),
        audioOnlyReason: start.audioOnlyReason,
        continuesRecordingId: same?.id ?? null,
        // A clock set back between the two gives no negative gap.
        gapMs: same ? Math.max(0, atMs - same.stoppedAt) : null,
      };
      running = { id: recording.id, meetingId, hasVideo: recording.video !== null };
      return facts;
    },
    /** The stop of recording `recordingId` was stamped at `atMs`; a second one changes nothing. */
    stopped(recordingId: string, atMs: number): void {
      if (running?.id !== recordingId) return;
      previous = { ...running, stoppedAt: atMs };
      running = null;
    },
  };
}
