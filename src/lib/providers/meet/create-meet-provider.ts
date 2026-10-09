/**
 * Google Meet. The meeting is identified by the code in the URL (`/abc-defg-hij`), admission by
 * the in-call UI, the people in the call by the page's people count, audio by Meet's WebRTC peer
 * connections, and tiles by Meet's data attributes. Muting sets `enabled = false` on the microphone
 * track, so no UI mute hint is needed. Who is in the call comes from the tiles' participant ids.
 */
import { installWebRtcCapture } from '@/lib/capture/install-web-rtc-capture';
import { findMeetTiles } from '@/lib/providers/meet/find-meet-tiles';
import { meetingTitleFromDocumentTitle } from '@/lib/providers/meet/meeting-title-from-document-title';
import { parseMeetingCode } from '@/lib/providers/meet/parse-meeting-code';
import { readDomHints } from '@/lib/providers/meet/read-dom-hints';
import { readMeetParticipantCount } from '@/lib/providers/meet/read-meet-participant-count';
import { readMeetPresence } from '@/lib/providers/meet/read-meet-presence';
import type { MeetingProvider } from '@/lib/providers/types';

export function createMeetProvider(): MeetingProvider {
  return {
    id: 'meet',
    readMeeting({ location, document }) {
      const meetingId = parseMeetingCode(location.pathname);
      const { admitted } = readDomHints(document);
      // Remote audio tracks cannot tell: Meet connects its audio slots before anyone joins. Without
      // the count they still decide, which starts a recording early rather than late.
      const people = admitted ? readMeetParticipantCount(document) : null;
      return {
        meetingId,
        title: meetingTitleFromDocumentTitle(document.title, meetingId),
        admitted,
        remoteParticipants: people === null ? null : people - 1,
      };
    },
    findTiles: findMeetTiles,
    readPresence({ location, document }) {
      const inCall =
        parseMeetingCode(location.pathname) !== null && readDomHints(document).admitted;
      return inCall ? readMeetPresence(document, readMeetParticipantCount(document)) : null;
    },
    // The people badge counts everyone and the self view marks the user; no list of everyone, and
    // no marker of a presentation has been verified.
    notesCapabilities: { count: true, roster: false, self: true, share: false, shareBy: false },
    installCapture: installWebRtcCapture,
  };
}
