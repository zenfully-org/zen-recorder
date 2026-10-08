/**
 * Zoom's web client (`app.zoom.us/wc/<meeting number>/join`, `…/start` for the host). The meeting
 * number comes from the URL, which is already set on the preview screen, so admission comes from
 * the meeting UI (toolbar plus a participant counter that includes the user). The other participants
 * are the counter without the user and without the waiting room, which a host's counter includes
 * (a guest who knocks is not in the meeting yet). Audio is the stream
 * the client plays through a detached `<audio>` element, tiles are regions of a shared canvas, and
 * muting is only visible on the audio button: the microphone track stays live and enabled.
 * Verified live in Firefox on 2026-10-01.
 */

import type { MeetingProvider } from '@/lib/providers/types';
import { findZoomTiles } from '@/lib/providers/zoom/find-zoom-tiles';
import { installZoomCapture } from '@/lib/providers/zoom/install-zoom-capture';
import { parseZoomMeetingId } from '@/lib/providers/zoom/parse-zoom-meeting-id';
import { readZoomDomHints } from '@/lib/providers/zoom/read-zoom-dom-hints';

export function createZoomProvider(): MeetingProvider {
  /** Whether the user left the call; nobody can have before the hooks are installed. */
  let userLeft = (): boolean => false;
  /** Canvas tiles have no frame clock: every composite pass may show a new picture. */
  let pass = 0;
  return {
    id: 'zoom',
    readMeeting({ location, document }) {
      const hints = readZoomDomHints(document);
      // Leaving is a page navigation about a second after the user confirmed it, with the meeting
      // UI still showing. Saying "no meeting" from the moment the call is over ends the recording
      // in time to be saved normally instead of being recovered after the page is gone.
      const meetingId = userLeft() ? null : parseZoomMeetingId(location.pathname);
      const admitted = meetingId !== null && hints.admitted;
      return {
        meetingId,
        title: hints.topic ?? (document.title.trim() || meetingId || 'Zoom meeting'),
        admitted,
        remoteParticipants:
          admitted && hints.participants !== null ? Math.max(0, hints.participants - 1) : null,
      };
    },
    readMicMuted: (document) => readZoomDomHints(document).micMuted,
    findTiles: (root) => findZoomTiles(root, ++pass),
    installCapture(win, listener) {
      const capture = installZoomCapture(win, listener);
      userLeft = capture.userLeft;
      return capture;
    },
  };
}
