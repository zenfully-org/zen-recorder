import { describe, expect, it } from 'vitest';
import { readCallState } from './read-call-state';

const capture = (tracks: number, connected = true) => ({
  anyConnected: () => connected,
  remoteAudioTracks: () => Array.from({ length: tracks }, () => ({})),
});

describe('readCallState', () => {
  it("counts the people by the provider's participant count, whatever the tracks", () => {
    // Zoom alone: one element plays the meeting's audio, nobody else is there.
    expect(readCallState({ remoteParticipants: 0 }, capture(1))).toEqual({
      connected: true,
      remoteTracks: 1,
      others: 0,
    });
    // Teams: everyone mixed into one track.
    expect(readCallState({ remoteParticipants: 3 }, capture(1))).toMatchObject({ others: 3 });
  });

  it('counts the people by the remote audio tracks when the provider cannot count them', () => {
    expect(readCallState({ remoteParticipants: null }, capture(2, false))).toEqual({
      connected: false,
      remoteTracks: 2,
      others: 2,
    });
  });
});
