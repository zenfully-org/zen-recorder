/**
 * The contract between the shared recorder and a meeting service ("provider"). Everything that
 * differs between Google Meet, Zoom and Microsoft Teams sits behind these types; the page session,
 * mixer, encoder, compositor, storage and finalize steps are shared. Types only.
 *
 * Adding a provider = a descriptor (static facts for the manifest and UI), a `MeetingProvider`
 * (page-side behaviour), a pair of thin entrypoints, a fixture page and the shared contract test
 * (`describeProviderContract`).
 */
import type { ProviderId, VideoTile } from '@/lib/types';

/** Static facts about a provider, usable anywhere (build config, background, popup, page). */
export interface ProviderDescriptor {
  id: ProviderId;
  /** Human-readable name, e.g. "Google Meet". */
  label: string;
  /** Match patterns (`https://host/*`) used for host permissions and the content scripts. */
  origins: string[];
  /**
   * Where the provider's fake page lives on the local fixture server: a path prefix such as
   * `/zoom`, or the empty string for the provider that owns every other path.
   */
  fixturePrefix: string;
  /** The hostname the provider sees when the page is the local fixture. */
  fixtureHostname: string;
}

/** The parts of `window.location` a provider reads (already normalized for the local fixture). */
export interface MeetingLocation {
  hostname: string;
  pathname: string;
  search: string;
  hash: string;
}

export interface MeetingPage {
  location: MeetingLocation;
  document: Document;
}

/** What a provider can tell about the meeting by looking at the page. Cheap: read every second. */
export interface MeetingState {
  /**
   * Stable id of the meeting the page is showing, or null when it is not a meeting (landing page,
   * chat view, after leaving). Drives the lifecycle (`null` ends a recording) and `{code}`.
   */
  meetingId: string | null;
  /** Human-readable meeting title; never empty (fall back to the id or "meeting"). */
  title: string;
  /**
   * The user is inside the call (in-call UI showing), not on a pre-join screen or knocking in a
   * lobby. Providers connect media before admission, so auto-start waits for this.
   */
  admitted: boolean;
  /**
   * Other participants currently in the call, when the page shows it reliably; null when unknown
   * (the number of remote audio tracks is used instead for the "first remote" start rule).
   */
  remoteParticipants: number | null;
}

/** A person in the call, as the page shows them. */
export interface Participant {
  /**
   * The most stable thing the page offers for the person: a service id, else
   * `name:<display name>` (`#2`, `#3`… for the second and third person of one name). Never a media
   * slot or an id the page gives each element it mounts.
   */
  key: string;
  name: string | null;
  /** The user themselves; null when the page does not say. */
  self: boolean | null;
}

/** Whether someone in the call shares a screen, as far as the page shows it. */
export type ScreenShareState =
  | { kind: 'none' }
  /** The page shows no share in a way the provider can read. */
  | { kind: 'unknown' }
  | {
      kind: 'active';
      /** The sharer's `Participant.key`, when the page names them. */
      participantKey: string | null;
      name: string | null;
      /** The user shares; false when the page does not say. */
      self: boolean;
    };

/** The user's microphone: heard, muted, or not connected to the call's audio at all. */
export type MicState = 'live' | 'muted' | 'not-connected';

/** Who is in the call and who shares, as the page shows it at one moment. */
export interface MeetingPresence {
  participants: Participant[];
  /**
   * `roster`: the page's list of everyone in the call. `stage`: the people shown on screen, which
   * can be fewer (layouts, paging, a hidden tab), so a person missing from it may still be there.
   */
  source: 'roster' | 'stage';
  /** People the page counts, the user included; null when it shows no count. */
  count: number | null;
  share: ScreenShareState;
  /**
   * The user's microphone as the page shows it; null when it cannot tell (the microphone track's
   * own state is used then). It only describes the call: `readMicMuted` decides what is recorded.
   */
  selfMic: MicState | null;
}

/** The most a provider can observe of a call's people. A reading never exceeds it. */
export interface NotesCapabilities {
  /** The page counts the people in the call. */
  count: boolean;
  /** The page lists everyone in the call, not only those on screen. */
  roster: boolean;
  /** The page marks the user's own tile. */
  self: boolean;
  /** The page shows that someone shares a screen. */
  share: boolean;
  /** The page shows who shares. */
  shareBy: boolean;
}

/** How a capture source reports what the meeting's media stack is doing. */
export interface CaptureListener {
  remoteAudioTrackAdded(track: MediaStreamTrack): void;
  remoteAudioTrackEnded(track: MediaStreamTrack): void;
  /** Something that affects `anyConnected()` or `connectionCount()` changed. */
  connectionsChanged(): void;
  /** The page acquired a microphone track (the recorder mixes a mirrored clone of it). */
  micTrackAdded(track: MediaStreamTrack): void;
}

/** A live view of the page's media, installed at `document_start` before the page's own scripts. */
export interface MediaCapture {
  /** Remote audio currently available for mixing (everyone but the user). */
  remoteAudioTracks(): MediaStreamTrack[];
  /** True while the page is connected to the call's media. */
  anyConnected(): boolean;
  /** Number of live media connections (diagnostics). */
  connectionCount(): number;
  /** Restores every patched global. */
  uninstall(): void;
}

/** Page-side behaviour of a provider (MAIN world). */
export interface MeetingProvider {
  id: ProviderId;
  /** Reads the meeting identity and admission state. Must never throw, whatever the DOM. */
  readMeeting(page: MeetingPage): MeetingState;
  /**
   * The mute state shown by the page's own UI, when muting is not reflected on the microphone
   * track (`track.enabled`). True silences the recorded microphone; null means "cannot tell".
   */
  readMicMuted?(document: Document): boolean | null;
  /**
   * Finds the video tiles to composite, in the order the page paints them: where two overlap, the
   * one shown on top comes later. Document order does that for tiles the page stacks as siblings
   * (a later sibling is painted over an earlier one). Called on every frame: nothing may be cached.
   */
  findTiles(root: ParentNode): VideoTile[];
  /**
   * Who is in the call, who shares and how the page shows the user's microphone, for the meeting
   * notes; null when it cannot tell right now (not a meeting, a pre-join screen or lobby, a call the
   * page no longer shows, a call the user is leaving). The rules every provider keeps:
   *   - It never throws, keeps nothing from one call to the next, measures no layout
   *     (`getBoundingClientRect`) and walks the page once.
   *   - A share is never a participant: a person's camera and their share are one participant.
   *   - A `stage` reading never proves that someone left.
   *   - `count` counts the user, so where `readMeeting` knows `remoteParticipants` too,
   *     `count - 1 === remoteParticipants`.
   *   - It stays within `notesCapabilities`: no `count` without `count`, no `roster` source without
   *     `roster`, no `self: true` (of a participant or a share) without `self`, a share `unknown`
   *     without `share`, and no sharer's key or name without `shareBy`.
   *   - `selfMic` is `not-connected` only where the page says so, never as a guess.
   * The page session does not feed it into the recording's lifecycle or snapshot.
   */
  readPresence(page: MeetingPage): MeetingPresence | null;
  /** The most `readPresence` can observe on this service, the same for every page. */
  notesCapabilities: NotesCapabilities;
  /**
   * Installs the page hooks that expose the call's audio (and anything else the provider needs).
   * Never throws, also where WebRTC is switched off and the page has no `RTCPeerConnection`.
   */
  installCapture(win: Window & typeof globalThis, listener: CaptureListener): MediaCapture;
}
