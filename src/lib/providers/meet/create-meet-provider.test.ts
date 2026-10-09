import { describe, expect, it } from 'vitest';
import { describeProviderContract } from '@/test/describe-provider-contract';
import { createFakeVideoTile } from '@/test/fakes/create-fake-video-tile';
import { createMeetProvider } from './create-meet-provider';
import { getMeetDescriptor } from './get-meet-descriptor';

const at = (pathname: string) => ({ hostname: 'meet.google.com', pathname, search: '', hash: '' });

function callControls(): HTMLElement {
  const icon = document.createElement('i');
  icon.className = 'google-symbols';
  icon.textContent = 'call_end';
  return icon;
}

describeProviderContract({
  descriptor: getMeetDescriptor(),
  createProvider: createMeetProvider,
  pages: {
    landing: () => {
      document.title = 'Google Meet';
      return at('/landing');
    },
    lobby: () => {
      // "Still trying to get in…": leave button and chat are there, tiles are not.
      document.title = 'Meet - abc-defg-hij';
      document.body.append(callControls());
      return at('/abc-defg-hij');
    },
    inCall: () => {
      document.title = 'Standup - Google Meet';
      const self = createFakeVideoTile(document, { participantId: 'me', self: true, name: 'You' });
      const remote = createFakeVideoTile(document, { participantId: 'p2', name: 'Ana' });
      document.body.append(callControls(), self.container, remote.container);
      return at('/abc-defg-hij');
    },
  },
  inCallTiles: 2,
});

describe('createMeetProvider', () => {
  it('takes the meeting id from the URL and the title from the tab title', () => {
    document.body.replaceChildren();
    document.title = 'Weekly sync - Google Meet';
    const provider = createMeetProvider();
    expect(provider.readMeeting({ location: at('/abc-defg-hij'), document })).toEqual({
      meetingId: 'abc-defg-hij',
      title: 'Weekly sync',
      admitted: false,
      remoteParticipants: null,
    });
  });

  it('relies on the microphone track for mute state', () => {
    expect(createMeetProvider().readMicMuted).toBeUndefined();
  });
});

describe('createMeetProvider, the people in the call', () => {
  const read = () => createMeetProvider().readMeeting({ location: at('/abc-defg-hij'), document });

  /** In the call, with Meet's people badge counting `people` (the user included) when given. */
  function inCall(people?: string) {
    document.body.replaceChildren();
    document.title = 'Standup - Google Meet';
    const self = createFakeVideoTile(document, { participantId: 'me', self: true, name: 'You' });
    document.body.append(callControls(), self.container);
    if (people !== undefined) {
      const badge = document.createElement('span');
      badge.setAttribute('data-avatar-count', people);
      document.body.append(badge);
    }
  }

  it.each([
    ['1', 0],
    ['2', 1],
    ['5', 4],
  ])('counts the others from the people count %s', (people, others) => {
    inCall(people);
    expect(read()).toMatchObject({ admitted: true, remoteParticipants: others });
  });

  it('leaves the count to the remote audio when the page shows none', () => {
    inCall();
    expect(read()).toMatchObject({ admitted: true, remoteParticipants: null });
  });

  it('counts no one before the user is let in', () => {
    // Meet's join screen shows who is in the call already; that is not the call the user is in.
    document.body.replaceChildren();
    const badge = document.createElement('span');
    badge.setAttribute('data-avatar-count', '3');
    document.body.append(callControls(), badge);
    expect(read()).toMatchObject({ admitted: false, remoteParticipants: null });
  });
});
