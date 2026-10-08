/**
 * Google Meet. The meeting is identified by the code in the URL (`/abc-defg-hij`), admission by
 * the in-call UI, audio by Meet's WebRTC peer connections, and tiles by Meet's data attributes.
 * Muting sets `enabled = false` on the microphone track, so no UI mute hint is needed.
 */
import { installWebRtcCapture } from '@/lib/capture/install-web-rtc-capture';
import { findMeetTiles } from '@/lib/providers/meet/find-meet-tiles';
import { meetingTitleFromDocumentTitle } from '@/lib/providers/meet/meeting-title-from-document-title';
import { parseMeetingCode } from '@/lib/providers/meet/parse-meeting-code';
import { readDomHints } from '@/lib/providers/meet/read-dom-hints';
import type { MeetingProvider } from '@/lib/providers/types';

export function createMeetProvider(): MeetingProvider {
  return {
    id: 'meet',
    readMeeting({ location, document }) {
      const meetingId = parseMeetingCode(location.pathname);
      return {
        meetingId,
        title: meetingTitleFromDocumentTitle(document.title, meetingId),
        admitted: readDomHints(document).admitted,
        // Meet shows no reliable count; remote audio tracks tell when someone else is there.
        remoteParticipants: null,
      };
    },
    findTiles: findMeetTiles,
    installCapture: installWebRtcCapture,
  };
}
