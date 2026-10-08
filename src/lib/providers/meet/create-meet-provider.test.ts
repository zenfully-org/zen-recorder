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
