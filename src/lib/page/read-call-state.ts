/**
 * What the tab snapshot says about the page's call: whether a connection is up, the remote audio
 * tracks the page plays, and the people besides the user. A provider that can count participants
 * decides the people (Zoom plays everyone's audio through one element and Teams mixes it into one
 * track, so a remote track does not mean someone is there); otherwise the remote audio tracks do.
 * The lifecycle starts on the people, and the status card and the popup say "Waiting for
 * participants" on them too.
 */
import type { MediaCapture, MeetingState } from '@/lib/providers/types';

export function readCallState(
  meeting: Pick<MeetingState, 'remoteParticipants'>,
  capture: Pick<MediaCapture, 'anyConnected'> & { remoteAudioTracks(): readonly unknown[] },
): { connected: boolean; remoteTracks: number; others: number } {
  const remoteTracks = capture.remoteAudioTracks().length;
  return {
    connected: capture.anyConnected(),
    remoteTracks,
    others: meeting.remoteParticipants ?? remoteTracks,
  };
}
