/**
 * Zoom's web client (`app.zoom.us/wc/<meeting number>/join`, `…/start` for the host). The meeting
 * number comes from the URL, which is already set on the preview screen, so admission comes from
 * the meeting UI (toolbar plus a participant counter that includes the user). The other participants
 * are the counter without the user and without the waiting room, which a host's counter includes
 * (a guest who knocks is not in the meeting yet). Audio is the stream
 * the client plays through a detached `<audio>` element, tiles are regions of a shared canvas, and
 * muting is only visible on the audio button: the microphone track stays live and enabled. Who
 * is in the call comes from the stage's tiles by name, and who shares from the share's user id.
 * Verified live in Firefox on 2026-10-01.
 */

import type { MeetingPage, MeetingProvider } from '@/lib/providers/types';
import { findZoomTiles } from '@/lib/providers/zoom/find-zoom-tiles';
import { installZoomCapture } from '@/lib/providers/zoom/install-zoom-capture';
import { parseZoomMeetingId } from '@/lib/providers/zoom/parse-zoom-meeting-id';
import { readZoomDomHints } from '@/lib/providers/zoom/read-zoom-dom-hints';
import { readZoomPresence } from '@/lib/providers/zoom/read-zoom-presence';

export function createZoomProvider(): MeetingProvider {
  /** Whether the user left the call; nobody can have before the hooks are installed. */
  let userLeft = (): boolean => false;
  /** Canvas tiles have no frame clock: every composite pass may show a new picture. */
  let pass = 0;
  const readCall = ({ location, document }: MeetingPage) => {
    const hints = readZoomDomHints(document);
    // Leaving is a page navigation about a second after the user confirmed it, with the meeting
    // UI still showing. Saying "no meeting" from the moment the call is over ends the recording
    // in time to be saved normally instead of being recovered after the page is gone.
    const meetingId = userLeft() ? null : parseZoomMeetingId(location.pathname);
    return { hints, meetingId, admitted: meetingId !== null && hints.admitted };
  };
  return {
    id: 'zoom',
    readMeeting(page) {
      const { hints, meetingId, admitted } = readCall(page);
      return {
        meetingId,
        title: hints.topic ?? (page.document.title.trim() || meetingId || 'Zoom meeting'),
        admitted,
        remoteParticipants:
          admitted && hints.participants !== null ? Math.max(0, hints.participants - 1) : null,
      };
    },
    readMicMuted: (document) => readZoomDomHints(document).micMuted,
    findTiles: (root) => findZoomTiles(root, ++pass),
    readPresence(page) {
      const { hints, admitted } = readCall(page);
      return admitted ? readZoomPresence(page.document, hints) : null;
    },
    // No tile is marked as the user's own, and the counter is the only list of everyone.
    notesCapabilities: { count: true, roster: false, self: false, share: true, shareBy: true },
    installCapture(win, listener) {
      const capture = installZoomCapture(win, listener);
      userLeft = capture.userLeft;
      return capture;
    },
  };
}
