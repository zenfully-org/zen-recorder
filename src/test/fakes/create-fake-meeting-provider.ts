/**
 * A meeting provider whose view of the page is whatever the test sets (`page`); the call's audio
 * still comes from the page's WebRTC connections. It sees nobody in the call.
 */
import { installWebRtcCapture } from '@/lib/capture/install-web-rtc-capture';
import type { MeetingProvider, MeetingState } from '@/lib/providers/types';
import type { VideoTile } from '@/lib/types';

export interface FakeMeetingProvider {
  provider: MeetingProvider;
  /** What the provider reads from the page: change it as the page would change. */
  page: { meeting: MeetingState; micMuted: boolean | null; tiles: VideoTile[] };
}

export function createFakeMeetingProvider(
  initial: Partial<MeetingState> = {},
): FakeMeetingProvider {
  const page: FakeMeetingProvider['page'] = {
    meeting: {
      meetingId: 'call-1',
      title: 'Planning',
      admitted: true,
      remoteParticipants: null,
      ...initial,
    },
    micMuted: null,
    tiles: [],
  };
  const provider: MeetingProvider = {
    id: 'zoom',
    readMeeting: () => page.meeting,
    readMicMuted: () => page.micMuted,
    findTiles: () => page.tiles,
    readPresence: () => null,
    notesCapabilities: { count: true, roster: false, self: false, share: true, shareBy: true },
    installCapture: installWebRtcCapture,
  };
  return { provider, page };
}
