/**
 * Microsoft Teams on the web (work, personal and the light meeting page of anonymous guests).
 * What differs from Meet, verified live in Firefox:
 *   - Only the join routes have the meeting in the URL, so the call UI says whether the page is a
 *     meeting: the pre-join, connecting and lobby screens, then the call screen.
 *   - Media is connected in the lobby already and all remote audio arrives as ONE mixed track, so
 *     admission and the number of participants come from the DOM.
 *   - Muting does not touch the track `getUserMedia` returned: the mute state is read from the UI.
 *   - Who is in the call, and who shares, comes from the call screen's tiles by name.
 */
import { installWebRtcCapture } from '@/lib/capture/install-web-rtc-capture';
import { findTeamsTiles } from '@/lib/providers/teams/find-teams-tiles';
import { parseTeamsMeetingId } from '@/lib/providers/teams/parse-teams-meeting-id';
import { readTeamsCallScreen } from '@/lib/providers/teams/read-teams-call-screen';
import { readTeamsMicMuted } from '@/lib/providers/teams/read-teams-mic-muted';
import { readTeamsPresence } from '@/lib/providers/teams/read-teams-presence';
import { readTeamsRosterCount } from '@/lib/providers/teams/read-teams-roster-count';
import { teamsTitleFromDocumentTitle } from '@/lib/providers/teams/teams-title-from-document-title';
import type { MediaCapture, MeetingProvider } from '@/lib/providers/types';

/** The id of a call whose URL does not name the meeting (a signed-in call). */
const UNNAMED_CALL_ID = 'teams-call';

interface KnownCall {
  id: string;
  title: string;
  admitted: boolean;
}

export function createTeamsProvider(): MeetingProvider {
  let capture: MediaCapture | null = null;
  /** The call the page is showing, or showed last while its media is still connected. */
  let call: KnownCall | null = null;
  let micMuted: boolean | null = null;

  return {
    id: 'teams',
    readMeeting({ location, document }) {
      const screen = readTeamsCallScreen(document);
      const title = teamsTitleFromDocumentTitle(document.title);
      if (screen === 'none') {
        // Teams is one app: the user can open the chat or the calendar while the call goes on
        // somewhere off screen. A call they were admitted to lasts as long as its media does.
        if (call?.admitted && capture?.anyConnected()) {
          return {
            meetingId: call.id,
            title: call.title,
            admitted: true,
            remoteParticipants: null,
          };
        }
        call = null;
        micMuted = null;
        return { meetingId: null, title, admitted: false, remoteParticipants: null };
      }
      const admitted = screen === 'call';
      // The URL names the meeting on the join routes only; once known, the id stays for the call.
      call = { id: parseTeamsMeetingId(location) ?? call?.id ?? UNNAMED_CALL_ID, title, admitted };
      const roster = admitted ? readTeamsRosterCount(document) : null;
      return {
        meetingId: call.id,
        title,
        admitted,
        // The badge counts the user too. Without it the mixed remote track decides (always 1).
        remoteParticipants: roster === null ? null : Math.max(0, roster - 1),
      };
    },
    readMicMuted(document) {
      // While the call is off screen there is no microphone button: keep what it said last.
      micMuted = readTeamsMicMuted(document) ?? micMuted;
      return micMuted;
    },
    findTiles: findTeamsTiles,
    readPresence: ({ document }) => readTeamsPresence(document),
    // The People badge counts everyone, but only the tiles on the stage name anyone.
    notesCapabilities: { count: true, roster: false, self: true, share: true, shareBy: true },
    installCapture(win, listener) {
      capture = installWebRtcCapture(win, listener);
      return capture;
    },
  };
}
