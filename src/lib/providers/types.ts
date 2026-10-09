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
  /** Installs the page hooks that expose the call's audio (and anything else the provider needs). */
  installCapture(win: Window & typeof globalThis, listener: CaptureListener): MediaCapture;
}
