import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CaptureListener, MediaCapture } from '@/lib/providers/types';
import { describeProviderContract } from '@/test/describe-provider-contract';
import { createFakeMediaCaptureWindow } from '@/test/fakes/create-fake-media-capture-window';
import { createFakeZoomPage } from '@/test/fakes/create-fake-zoom-page';
import { createZoomProvider } from './create-zoom-provider';
import { getZoomDescriptor } from './get-zoom-descriptor';

const at = (pathname: string) => ({ hostname: 'app.zoom.us', pathname, search: '', hash: '' });
const MEETING = at('/wc/86866414938/join');
const HOST_MEETING = at('/wc/86866414938/start');
const LEFT = { x: 0, y: 180, width: 640, height: 360 };
const RIGHT = { x: 640, y: 180, width: 640, height: 360 };
/** Zoom numbers its users 1024 apart. */
const userId = (index: number) => String(16778240 + 1024 * index);

function createListener(): CaptureListener {
  return {
    remoteAudioTrackAdded: () => undefined,
    remoteAudioTrackEnded: () => undefined,
    connectionsChanged: () => undefined,
    micTrackAdded: () => undefined,
  };
}

describeProviderContract({
  descriptor: getZoomDescriptor(),
  createProvider: createZoomProvider,
  createWindow: createFakeMediaCaptureWindow,
  pages: {
    landing: () => {
      // Where the client goes after a meeting: its shell.
      document.title = 'Zoom';
      return at('/wc/home');
    },
    lobby: () => {
      // The preview screen: camera and microphone are already live, the meeting URL is set.
      document.title = 'Zoom meeting on web';
      createFakeZoomPage(document).showPreview();
      return MEETING;
    },
    inCall: () => {
      document.title = 'Weekly sync';
      const page = createFakeZoomPage(document);
      page.showMeeting({ topic: 'Weekly sync', participants: 2 });
      page.addVideoTile({ name: 'Zen Recorder', rect: LEFT });
      page.addAvatarTile({ name: 'Remote Person', rect: RIGHT });
      return MEETING;
    },
    call: ({ others, share }) => {
      document.title = 'Weekly sync';
      const page = createFakeZoomPage(document);
      page.showMeeting({ topic: 'Weekly sync', participants: others.length + 1 });
      page.addVideoTile({ nodeId: userId(0), name: 'Zen Recorder' });
      others.forEach(({ name, camera }, index) => {
        if (camera === false) page.addAvatarTile({ name });
        else page.addVideoTile({ nodeId: userId(index + 1), name });
      });
      const sharer = others.findIndex(({ name }) => name === share?.by);
      if (share) page.startShare({ nodeId: userId(sharer + 1) });
      return MEETING;
    },
  },
  inCallTiles: 2,
});

describe('createZoomProvider', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    document.title = '';
    document.body.replaceChildren();
  });
  afterEach(() => vi.useRealTimers());

  it('reads the meeting number from the URL and the rest from the meeting UI', () => {
    const page = createFakeZoomPage(document);
    page.showMeeting({ topic: 'Weekly sync', participants: 3 });
    document.title = 'Something else';
    expect(createZoomProvider().readMeeting({ location: MEETING, document })).toEqual({
      meetingId: '86866414938',
      title: 'Weekly sync',
      admitted: true,
      remoteParticipants: 2,
    });
  });

  it('falls back to the tab title, then the meeting number, then a generic title', () => {
    const provider = createZoomProvider();
    expect(provider.readMeeting({ location: MEETING, document }).title).toBe('86866414938');
    expect(provider.readMeeting({ location: at('/wc/home'), document }).title).toBe('Zoom meeting');
    document.title = ' Zoom meeting on web ';
    expect(provider.readMeeting({ location: MEETING, document }).title).toBe('Zoom meeting on web');
  });

  it.each([
    // The footer renders while "Joining Meeting…" and in the waiting room: nobody is counted yet.
    ['while joining or waiting to be let in', 0, false, null],
    ['alone in the meeting', 1, true, 0],
    ['with two others', 3, true, 2],
  ])('%s: admitted %j, others %j', (_label, participants, admitted, remoteParticipants) => {
    createFakeZoomPage(document).showMeeting({ participants });
    expect(createZoomProvider().readMeeting({ location: MEETING, document })).toMatchObject({
      meetingId: '86866414938',
      admitted,
      remoteParticipants,
    });
  });

  describe('as the host, with a guest in the waiting room (the counter includes the waiting room)', () => {
    it('counts nobody else while the guest waits, and the guest once let in', () => {
      const page = createFakeZoomPage(document);
      page.showMeeting({ host: true, participants: 1 });
      const read = () => createZoomProvider().readMeeting({ location: HOST_MEETING, document });
      expect(read()).toMatchObject({ admitted: true, remoteParticipants: 0 });
      page.setWaiting(1);
      expect(
        document.querySelector('#participant .footer-button__number-counter')?.textContent,
      ).toBe('2');
      expect(read()).toMatchObject({ admitted: true, remoteParticipants: 0 });
      page.setWaiting(0);
      page.setParticipants(2);
      expect(read()).toMatchObject({ admitted: true, remoteParticipants: 1 });
    });

    it('still counts nobody else with the participants panel open', () => {
      const page = createFakeZoomPage(document);
      page.showMeeting({ host: true, participants: 1, waiting: 2 });
      page.showParticipantsPanel();
      expect(createZoomProvider().readMeeting({ location: HOST_MEETING, document })).toMatchObject({
        admitted: true,
        remoteParticipants: 0,
      });
    });

    it('counts the others in the meeting, not the ones still waiting', () => {
      createFakeZoomPage(document).showMeeting({ host: true, participants: 3, waiting: 2 });
      expect(createZoomProvider().readMeeting({ location: HOST_MEETING, document })).toMatchObject({
        admitted: true,
        remoteParticipants: 2,
      });
    });
  });

  it('does not count participants it cannot see', () => {
    const page = createFakeZoomPage(document);
    page.showMeeting({ participants: null });
    page.addAvatarTile();
    expect(createZoomProvider().readMeeting({ location: MEETING, document })).toMatchObject({
      admitted: true,
      remoteParticipants: null,
    });
  });

  it('is not admitted by a meeting UI on a page that is not a meeting', () => {
    createFakeZoomPage(document).showMeeting({ participants: 2 });
    expect(createZoomProvider().readMeeting({ location: at('/wc/home'), document })).toEqual({
      meetingId: null,
      title: 'Zoom meeting',
      admitted: false,
      remoteParticipants: null,
    });
  });

  it('reads the mute state from the audio button: muting leaves the microphone track alone', () => {
    const provider = createZoomProvider();
    const page = createFakeZoomPage(document);
    page.showMeeting({ audio: 'unmuted' });
    expect(provider.readMicMuted?.(document)).toBe(false);
    page.setAudio('muted');
    expect(provider.readMicMuted?.(document)).toBe(true);
  });

  it('gives canvas tiles a new frame key on every pass', () => {
    const page = createFakeZoomPage(document);
    page.showMeeting();
    page.addVideoTile();
    const provider = createZoomProvider();
    const keys = [1, 2, 3].map(() => provider.findTiles(document)[0]?.frameKey);
    expect(new Set(keys).size).toBe(3);
  });

  describe('leaving (a navigation about a second after the user confirmed it)', () => {
    const installed: MediaCapture[] = [];
    afterEach(() => {
      for (const capture of installed.splice(0)) capture.uninstall();
    });

    function inMeeting() {
      const win = createFakeMediaCaptureWindow();
      const provider = createZoomProvider();
      installed.push(provider.installCapture(win.win, createListener()));
      const zoom = createFakeZoomPage(document);
      zoom.showMeeting({ topic: 'Weekly sync', participants: 2 });
      const pc = win.openConnection();
      pc.setConnectionState('connected');
      vi.advanceTimersByTime(100);
      const close = () => {
        // close() fires no event and the meeting UI stays up until the page navigates.
        pc.connectionState = 'closed';
        pc.iceConnectionState = 'closed';
      };
      return {
        win,
        zoom,
        close,
        read: () => provider.readMeeting({ location: MEETING, document }),
        readPresence: () => provider.readPresence({ location: MEETING, document }),
      };
    }

    it('reports no meeting once the user confirmed leaving and the connections are closed', () => {
      const { zoom, close, read, readPresence } = inMeeting();
      expect(read()).toMatchObject({ meetingId: '86866414938', admitted: true });
      zoom.showLeaveOptions().click();
      expect(read()).toMatchObject({ meetingId: '86866414938', admitted: true });
      expect(readPresence()).toMatchObject({ count: 2 });
      close();
      expect(read()).toEqual({
        meetingId: null,
        title: 'Weekly sync',
        admitted: false,
        remoteParticipants: null,
      });
      // The meeting UI is still up, but its people are no longer the user's call.
      expect(readPresence()).toBeNull();
    });

    it('keeps the meeting through a reconnect: closed connections alone are not a leave', () => {
      const { win, close, read } = inMeeting();
      close();
      vi.advanceTimersByTime(100);
      expect(read()).toMatchObject({ meetingId: '86866414938', admitted: true });
      win.openConnection().setConnectionState('connected');
      expect(read()).toMatchObject({ meetingId: '86866414938', admitted: true });
    });

    it('takes the meeting back when the confirmed leave did not happen', () => {
      const { zoom, read } = inMeeting();
      zoom.showLeaveOptions().click();
      vi.advanceTimersByTime(5000);
      expect(read()).toMatchObject({ meetingId: '86866414938', admitted: true });
    });
  });
});
