/**
 * What the tab snapshot says about the page's call: whether a connection is up, the remote audio
 * tracks the page plays, the people besides the user, and whether the call is at an address that
 * names no meeting the provider knows. A provider that can count participants decides the people
 * (Zoom plays everyone's audio through one element and Teams mixes it into one track, so a remote
 * track does not mean someone is there); otherwise the remote audio tracks do. The lifecycle
 * starts on the people, and the status card and the popup say "Waiting for participants" on them
 * too. A call the provider cannot name records nothing, which they say while it lasts.
 */
import type { MediaCapture, MeetingState } from '@/lib/providers/types';
import type { TabSnapshot } from '@/lib/types';

export function readCallState(
  meeting: Pick<MeetingState, 'remoteParticipants' | 'meetingId' | 'admitted'>,
  capture: Pick<MediaCapture, 'anyConnected'> & { remoteAudioTracks(): readonly unknown[] },
): Pick<TabSnapshot, 'connected' | 'remoteTracks' | 'unknownAddress'> & { others: number } {
  const remoteTracks = capture.remoteAudioTracks().length;
  return {
    connected: capture.anyConnected(),
    remoteTracks,
    others: meeting.remoteParticipants ?? remoteTracks,
    ...(meeting.admitted && meeting.meetingId === null ? { unknownAddress: true } : {}),
  };
}
