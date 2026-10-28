import { describe, expect, it } from 'vitest';
import { readCallState } from './read-call-state';

const capture = (tracks: number, connected = true) => ({
  anyConnected: () => connected,
  remoteAudioTracks: () => Array.from({ length: tracks }, () => ({})),
});

/** A page the provider reads as a meeting the user is in. */
const inMeeting = { meetingId: 'abc-defg-hij', admitted: true };

describe('readCallState', () => {
  it("counts the people by the provider's participant count, whatever the tracks", () => {
    // Zoom alone: one element plays the meeting's audio, nobody else is there.
    expect(readCallState({ ...inMeeting, remoteParticipants: 0 }, capture(1))).toEqual({
      connected: true,
      remoteTracks: 1,
      others: 0,
    });
    // Teams: everyone mixed into one track.
    expect(readCallState({ ...inMeeting, remoteParticipants: 3 }, capture(1))).toMatchObject({
      others: 3,
    });
  });

  it('counts the people by the remote audio tracks when the provider cannot count them', () => {
    expect(readCallState({ ...inMeeting, remoteParticipants: null }, capture(2, false))).toEqual({
      connected: false,
      remoteTracks: 2,
      others: 2,
    });
  });

  // Only a call the provider cannot name: a page that is no call, or not in it yet, is no fault.
  it.each([
    [true, null, true],
    [false, null, false],
    [true, 'abc-defg-hij', false],
    [false, 'abc-defg-hij', false],
  ])('admitted %j with meeting %j: says the address is unknown %j', (admitted, meetingId, says) => {
    const read = readCallState({ meetingId, admitted, remoteParticipants: 1 }, capture(1));
    expect(read.unknownAddress === true).toBe(says);
    expect(read).toMatchObject({ connected: true, remoteTracks: 1, others: 1 });
  });
});
