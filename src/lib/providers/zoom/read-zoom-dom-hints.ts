/**
 * What the Zoom web client's DOM tells about the meeting. Everything is read from ids, BEM class
 * names and icon class names, never from visible text or translated aria-labels; the waiting room
 * comes from `readZoomWaitingRoom`. Verified live in Firefox on 2026-10-01.
 */
import type { MicState } from '@/lib/providers/types';
import { readZoomWaitingRoom } from '@/lib/providers/zoom/read-zoom-waiting-room';

/** The meeting toolbar. Not proof of admission: it renders while joining and in the waiting room. */
const FOOTER = '#wc-footer';
/**
 * The number next to "Participants": everyone in the meeting, the user included, and for a host or
 * co-host everyone in the waiting room as well.
 */
const PARTICIPANT_COUNTER = '#participant .footer-button__number-counter';
/** A participant on the stage: with the camera on, or as an avatar. */
const STAGE_TILE = '.main-layout video-player, .main-layout .video-avatar__avatar';
/** The icon of the audio button names what a click would do. */
const AUDIO_ICON = 'button.join-audio-container__btn svg';
const TOPIC = '.meeting-info-icon__title';

/**
 * Icon class prefixes (hovering appends `Hovered`), most specific first: `SvgAudioUnmute` while
 * muted (`SvgAudioUnmuteDisallowed` when the microphone cannot be used), `SvgAudioMute` while live,
 * `SvgAudioJoin` while the user has not joined the audio.
 */
const AUDIO_ICONS: [prefix: string, mic: MicState][] = [
  ['SvgAudioUnmute', 'muted'],
  ['SvgAudioMute', 'live'],
  ['SvgAudioJoin', 'not-connected'],
];

export interface ZoomDomHints {
  /** The meeting toolbar is showing. */
  inMeetingUi: boolean;
  /**
   * The user is in the meeting: the toolbar plus a participant counter of at least one (the user).
   * The counter stays at zero while joining, in the waiting room and after a join that failed.
   */
  admitted: boolean;
  /**
   * People in the meeting, the user included, without the waiting room; null when the counter is
   * not showing.
   */
  participants: number | null;
  /** People in the waiting room, as the page shows them to a host or co-host; 0 otherwise. */
  waiting: number;
  /** The microphone state the audio button shows; null when it cannot be told. */
  mic: MicState | null;
  /**
   * Whether the meeting does not hear the microphone: muted, or the audio not joined (the meeting
   * does not hear the microphone then either); null when it cannot be told.
   */
  micMuted: boolean | null;
  /** The meeting topic from the header; null when it is not showing. */
  topic: string | null;
}

function readCounter(root: ParentNode): number | null {
  const digits = /^\d+/.exec(root.querySelector(PARTICIPANT_COUNTER)?.textContent?.trim() ?? '');
  return digits ? Number(digits[0]) : null;
}

function readMic(root: ParentNode): MicState | null {
  const names = (root.querySelector(AUDIO_ICON)?.getAttribute('class') ?? '').split(/\s+/);
  const match = AUDIO_ICONS.find(([prefix]) => names.some((name) => name.startsWith(prefix)));
  return match ? match[1] : null;
}

export function readZoomDomHints(root: ParentNode): ZoomDomHints {
  const inMeetingUi = root.querySelector(FOOTER) !== null;
  const counter = readCounter(root);
  const waiting = readZoomWaitingRoom(root);
  const counted = counter === null ? root.querySelector(STAGE_TILE) !== null : counter > 0;
  const mic = readMic(root);
  return {
    inMeetingUi,
    admitted: inMeetingUi && counted,
    participants: counter === null ? null : Math.max(0, counter - waiting),
    waiting,
    mic,
    micMuted: mic === null ? null : mic !== 'live',
    topic: root.querySelector(TOPIC)?.textContent?.trim() || null,
  };
}
