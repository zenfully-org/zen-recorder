import { beforeEach, describe, expect, it } from 'vitest';
import type { CaptureListener, MeetingLocation } from '@/lib/providers/types';
import { describeProviderContract } from '@/test/describe-provider-contract';
import { createFakeCaptureWindow } from '@/test/fakes/create-fake-capture-window';
import { createFakeTeamsPage } from '@/test/fakes/create-fake-teams-page';
import { createTeamsProvider } from './create-teams-provider';
import { getTeamsDescriptor } from './get-teams-descriptor';

const THREAD = '19:meeting_MDAwMDAwMDAtZmFrZS1mYWtl@thread.v2';
const MEETING_ID = 'meeting_MDAwMDAwMDAtZmFrZS1mYWtl';
const at = (pathname: string, search = ''): MeetingLocation => ({
  hostname: 'teams.microsoft.com',
  pathname,
  search,
  hash: '',
});
/** Where an anonymous guest's call lives: the thread id stays in `coords` the whole time. */
const guestPage = () =>
  at(
    '/light-meetings/launch',
    `?anon=true&coords=${btoa(JSON.stringify({ conversationId: THREAD }))}`,
  );
/** Where a signed-in call lives: nothing in the URL says which meeting it is. */
const appPage = () => at('/v2/');

const teams = createFakeTeamsPage(document);
const twoTiles = [{ name: 'Ana Silva' }, { name: 'Zen Recorder guest', self: true }];
const listener: CaptureListener = {
  remoteAudioTrackAdded: () => undefined,
  remoteAudioTrackEnded: () => undefined,
  connectionsChanged: () => undefined,
  micTrackAdded: () => undefined,
};

describeProviderContract({
  descriptor: getTeamsDescriptor(),
  createProvider: createTeamsProvider,
  pages: {
    landing: () => {
      document.title = 'Chat | Microsoft Teams';
      return appPage();
    },
    lobby: () => {
      document.title = 'Microsoft Teams meeting | Microsoft Teams';
      teams.showLobby();
      return guestPage();
    },
    inCall: () => {
      document.title = 'Weekly sync | Microsoft Teams';
      teams.showCall({ roster: '2', tiles: twoTiles });
      return appPage();
    },
    call: ({ others, share }) => {
      document.title = 'Weekly sync | Microsoft Teams';
      teams.showCall({
        roster: String(others.length + 1),
        tiles: [
          { name: 'Zen Recorder guest', self: true },
          ...others.map(({ name, camera }) => ({ name, camera: camera !== false })),
          ...(share ? [{ name: share.by, stream: 'ScreenSharing' as const }] : []),
        ],
      });
      return appPage();
    },
  },
  inCallTiles: 2,
});

describe('createTeamsProvider', () => {
  beforeEach(() => {
    document.title = 'Weekly sync | Microsoft Teams';
    document.body.replaceChildren();
  });

  it('identifies the meeting by the thread in the URL and titles it after the tab', () => {
    teams.showPrejoin();
    expect(createTeamsProvider().readMeeting({ location: guestPage(), document })).toEqual({
      meetingId: MEETING_ID,
      title: 'Weekly sync',
      admitted: false,
      remoteParticipants: null,
    });
  });

  it.each([
    ['the pre-join screen', () => teams.showPrejoin()],
    ['the connecting screen', () => teams.showConnecting()],
    ['the lobby', () => teams.showLobby()],
  ])('reports a meeting the user is not in yet on %s', (_name, build) => {
    build();
    const meeting = createTeamsProvider().readMeeting({ location: appPage(), document });
    expect(meeting).toMatchObject({ meetingId: 'teams-call', admitted: false });
  });

  it('gives a call without anything in the URL a generic id', () => {
    teams.showCall({ tiles: twoTiles });
    expect(createTeamsProvider().readMeeting({ location: appPage(), document })).toEqual({
      meetingId: 'teams-call',
      title: 'Weekly sync',
      admitted: true,
      remoteParticipants: null,
    });
  });

  it.each([
    ['1', 0],
    ['2', 1],
    ['12', 11],
    ['0', 0],
  ])('counts the others from the People badge "%s"', (roster, others) => {
    teams.showCall({ roster });
    const meeting = createTeamsProvider().readMeeting({ location: appPage(), document });
    expect(meeting.remoteParticipants).toBe(others);
  });

  it('does not count participants before the user is in the call', () => {
    teams.showCall({ roster: '3' });
    teams.showLobby();
    const meeting = createTeamsProvider().readMeeting({ location: appPage(), document });
    expect(meeting).toMatchObject({ admitted: false, remoteParticipants: null });
  });

  it('keeps the meeting id when the URL loses it during the call', () => {
    const provider = createTeamsProvider();
    teams.showPrejoin();
    expect(provider.readMeeting({ location: guestPage(), document }).meetingId).toBe(MEETING_ID);
    document.body.replaceChildren();
    teams.showCall();
    expect(provider.readMeeting({ location: appPage(), document }).meetingId).toBe(MEETING_ID);
  });

  it('prefers the id in the URL over the one it made up', () => {
    const provider = createTeamsProvider();
    teams.showPrejoin();
    expect(provider.readMeeting({ location: appPage(), document }).meetingId).toBe('teams-call');
    expect(provider.readMeeting({ location: guestPage(), document }).meetingId).toBe(MEETING_ID);
  });

  it('forgets the meeting once the call UI is gone', () => {
    const provider = createTeamsProvider();
    teams.showCall();
    expect(provider.readMeeting({ location: guestPage(), document }).meetingId).toBe(MEETING_ID);
    document.body.replaceChildren();
    document.title = 'Chat | Microsoft Teams';
    expect(provider.readMeeting({ location: guestPage(), document })).toEqual({
      meetingId: null,
      title: 'Chat',
      admitted: false,
      remoteParticipants: null,
    });
    teams.showPrejoin();
    expect(provider.readMeeting({ location: appPage(), document }).meetingId).toBe('teams-call');
  });

  describe('while the call is not on screen (the user went to another part of Teams)', () => {
    function joinCall() {
      const page = createFakeCaptureWindow();
      const provider = createTeamsProvider();
      provider.installCapture(page.win, listener);
      const connection = page.openConnection();
      connection.setConnectionState('connected');
      return { provider, connection, page };
    }

    it('keeps reporting the call as long as its media is connected', () => {
      const { provider, connection, page } = joinCall();
      teams.showCall({ roster: '4' });
      provider.readMeeting({ location: guestPage(), document });
      document.body.replaceChildren();
      document.title = 'Chat | Microsoft Teams';
      expect(provider.readMeeting({ location: appPage(), document })).toEqual({
        meetingId: MEETING_ID,
        title: 'Weekly sync',
        admitted: true,
        remoteParticipants: null,
      });
      // Nothing on screen tells who is in the call meanwhile.
      expect(provider.readPresence({ location: appPage(), document })).toBeNull();
      connection.close();
      expect(provider.readMeeting({ location: appPage(), document }).meetingId).toBeNull();
      // The call is over for good: a new connection alone does not bring it back.
      page.openConnection().setConnectionState('connected');
      expect(provider.readMeeting({ location: appPage(), document }).meetingId).toBeNull();
    });

    it('does not hold on to a meeting the user never got into', () => {
      const { provider } = joinCall();
      teams.showLobby();
      provider.readMeeting({ location: guestPage(), document });
      document.body.replaceChildren();
      expect(provider.readMeeting({ location: guestPage(), document }).meetingId).toBeNull();
    });

    it('lets a waiting screen end the admission', () => {
      const { provider } = joinCall();
      teams.showCall();
      provider.readMeeting({ location: guestPage(), document });
      document.body.replaceChildren();
      teams.showLobby();
      expect(provider.readMeeting({ location: guestPage(), document }).admitted).toBe(false);
      document.body.replaceChildren();
      expect(provider.readMeeting({ location: guestPage(), document }).meetingId).toBeNull();
    });

    it('needs its capture to tell: without one the call ends with its UI', () => {
      const provider = createTeamsProvider();
      teams.showCall();
      provider.readMeeting({ location: guestPage(), document });
      document.body.replaceChildren();
      expect(provider.readMeeting({ location: guestPage(), document }).meetingId).toBeNull();
    });

    it('keeps the microphone state it last saw, and drops it when the call ends', () => {
      const { provider, connection } = joinCall();
      teams.showCall({ mic: 'off' });
      provider.readMeeting({ location: guestPage(), document });
      expect(provider.readMicMuted?.(document)).toBe(true);
      document.body.replaceChildren();
      provider.readMeeting({ location: guestPage(), document });
      expect(provider.readMicMuted?.(document)).toBe(true);
      connection.close();
      provider.readMeeting({ location: guestPage(), document });
      expect(provider.readMicMuted?.(document)).toBeNull();
    });
  });

  it('reads the mute state from the page, not from the microphone track', () => {
    const provider = createTeamsProvider();
    teams.showCall({ mic: 'on' });
    expect(provider.readMicMuted?.(document)).toBe(false);
    document.body.replaceChildren();
    teams.showPrejoin({ micOn: false });
    expect(provider.readMicMuted?.(document)).toBe(true);
  });

  it('composites the stage tiles', () => {
    teams.showCall({ tiles: twoTiles });
    expect(
      createTeamsProvider()
        .findTiles(document)
        .map((tile) => tile.name),
    ).toEqual(['Ana Silva', 'Zen Recorder guest']);
  });
});
