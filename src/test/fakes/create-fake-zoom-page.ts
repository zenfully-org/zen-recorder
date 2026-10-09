/**
 * Builds the Zoom web client's DOM in happy-dom, as read from the real client in Firefox on
 * 2026-10-01: the preview screen, the meeting UI (footer with the audio button and the participant
 * counter), and tiles painted into the shared shadow-root canvas of a `<video-player-container>`.
 * Rects are whatever the test says, since happy-dom has no layout. The host's view of the waiting
 * room (the counter and the Participants button's label include it, the open participants panel
 * names it in a section title) follows the client's bundle, read on 2026-10-04 and not verified
 * live yet.
 */
import type { Box } from '@/lib/types';

export type FakeZoomAudio = 'unmuted' | 'muted' | 'not-joined';

export interface FakeZoomMeetingOptions {
  topic?: string;
  /**
   * People in the meeting, the user included; null leaves the counter out. The counter shows them,
   * plus the waiting room when the user is the host.
   */
  participants?: number | null;
  /** The user is the host or a co-host: the waiting room shows, and the counter includes it. */
  host?: boolean;
  /** People in the waiting room. */
  waiting?: number;
  audio?: FakeZoomAudio;
  /** Size of the stage and of its shared canvas, in CSS pixels. */
  stage?: Box;
  /** Canvas pixels per CSS pixel. */
  scale?: number;
}

export interface FakeZoomTileOptions {
  nodeId?: string;
  name?: string | null;
  rect?: Box;
}

interface FakeZoomShareOptions {
  rect?: Box;
  /** The sharer's user id (the `node-id` of their camera tile); `16778240` by default. */
  nodeId?: string;
}

export interface FakeZoomPage {
  /** The pre-join screen: camera preview (its own canvas), name field, Join button. */
  showPreview(rect?: Box): void;
  /** The meeting UI without any tile yet. */
  showMeeting(options?: FakeZoomMeetingOptions): void;
  setAudio(audio: FakeZoomAudio): void;
  setParticipants(count: number | null): void;
  /** People in the waiting room: a guest knocks (+1) or is let in (-1, and `setParticipants`). */
  setWaiting(count: number): void;
  /** Opens the participants panel: the waiting room moves from the button's label to the panel. */
  showParticipantsPanel(): void;
  /** A participant with the camera on: a `<video-player>` placeholder over the shared canvas. */
  addVideoTile(options?: FakeZoomTileOptions): HTMLElement;
  /** A participant with the camera off: the avatar tile with the name in the middle. */
  addAvatarTile(options?: FakeZoomTileOptions): HTMLElement;
  /**
   * A remote screen share in the share container (its own canvas): its player is
   * `video-player[name="share-content"][media-type="share"]` with the sharer's user id as `node-id`.
   */
  startShare(options?: FakeZoomShareOptions): HTMLElement;
  /**
   * The share ends: the share container stays, without a canvas, its player back to
   * `media-type="video"` and an empty `node-id`, as Zoom shows it while nobody shares.
   */
  stopShare(): void;
  /** The confirmation that opens after the Leave/End button: returns its "Leave Meeting" button. */
  showLeaveOptions(): HTMLElement;
  /** The shared canvas of the stage; null until a tile with video exists. */
  stageCanvas(): HTMLCanvasElement | null;
  /** Gives an element an on-screen rect (happy-dom has no layout). */
  place(element: Element, rect: Box): void;
}

const AUDIO_ICON: Record<FakeZoomAudio, string> = {
  unmuted: 'SvgAudioMute',
  muted: 'SvgAudioUnmute',
  'not-joined': 'SvgAudioJoin',
};
const SVG_NS = 'http://www.w3.org/2000/svg';
const DEFAULT_STAGE: Box = { x: 0, y: 0, width: 1280, height: 720 };

function place(element: Element, rect: Box): void {
  Object.defineProperty(element, 'getBoundingClientRect', {
    value: () => ({
      ...rect,
      left: rect.x,
      top: rect.y,
      right: rect.x + rect.width,
      bottom: rect.y + rect.height,
    }),
    configurable: true,
  });
}

/** The Participants button's label, as the client builds it (not translated, typo included). */
function participantsLabel(host: boolean, panelOpen: boolean, shown: number, waiting: number) {
  if (!host) {
    return panelOpen
      ? 'close the participants list pane'
      : `open the participants list pane,[${shown}] particpants`;
  }
  if (panelOpen) return 'close the manage participants list pane';
  const label = `open the manage participants list pane,${shown} particpants`;
  return waiting > 0 ? `${label},${waiting} people are in waiting room` : label;
}

/** Zoom's share container once the share ends: no canvas, its player named by no one. */
function endShare(doc: Document): void {
  const container = doc.querySelector('#sharee-container video-player-container');
  container?.shadowRoot?.querySelector('canvas')?.remove();
  const player = container?.querySelector('video-player');
  player?.setAttribute('node-id', '');
  player?.setAttribute('media-type', 'video');
}

export function createFakeZoomPage(doc: Document): FakeZoomPage {
  let stage: Box = DEFAULT_STAGE;
  let scale = 1;
  let tiles = 0;
  let inMeeting: number | null = 1;
  let waiting = 0;
  let host = false;
  let panelOpen = false;

  const el = (tag: string, className = ''): HTMLElement => {
    const element = doc.createElement(tag);
    if (className) element.className = className;
    return element;
  };

  const icon = (name: string): Element => {
    const svg = doc.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('class', name);
    return svg;
  };

  /** A `<video-player-container>` with the open shadow root the client gives it. */
  const playerContainer = (className: string, rect: Box): HTMLElement => {
    const container = el('video-player-container', className);
    container.attachShadow({ mode: 'open' }).append(doc.createElement('slot'));
    place(container, rect);
    return container;
  };

  /** The client creates the canvas when the first video of a container starts. */
  const ensureCanvas = (container: HTMLElement, rect: Box): HTMLCanvasElement => {
    const root = container.shadowRoot;
    if (!root) throw new Error('the container has no shadow root');
    const existing = root.querySelector('canvas');
    if (existing) return existing;
    const canvas = doc.createElement('canvas');
    canvas.id = `video-player-canvas-${++tiles}`;
    canvas.width = rect.width * scale;
    canvas.height = rect.height * scale;
    place(canvas, rect);
    root.prepend(canvas);
    return canvas;
  };

  const stageContainer = (): HTMLElement => {
    const container = doc.querySelector<HTMLElement>('.main-layout > video-player-container');
    if (!container) throw new Error('call showMeeting() first');
    return container;
  };

  const footerName = (name: string | null): HTMLElement => {
    const footer = el('div', 'video-avatar__avatar-footer');
    if (name !== null) {
      const span = el('span');
      span.setAttribute('role', 'none');
      span.textContent = name;
      footer.append(span);
    }
    return footer;
  };

  /** A section title of the participants panel (the panel shows them only with two sections). */
  const sectionTitle = (title: string, waitingRoom: boolean): HTMLElement => {
    const section = el(
      'div',
      waitingRoom
        ? 'collapsible-section-title waiting-room-list-container__title-section'
        : 'collapsible-section-title',
    );
    const left = el('div', 'collapsible-section-title__left');
    const trigger = el('span', 'collapsible-section-title__trigger');
    trigger.setAttribute('role', 'button');
    trigger.textContent = title;
    trigger.append(el('span', 'collapsible-section-title__icon'));
    left.append(trigger);
    section.append(left);
    return section;
  };

  /** The counter, the Participants button's label and the open panel's section titles. */
  const renderParticipants = (): void => {
    const button = doc.querySelector('#participant button');
    button?.replaceChildren();
    const panel = doc.querySelector('.participants-section-container');
    panel?.replaceChildren();
    if (inMeeting === null) return;
    const shown = inMeeting + (host ? waiting : 0);
    button?.setAttribute('aria-label', participantsLabel(host, panelOpen, shown, waiting));
    const counter = el('span', 'footer-button__number-counter');
    const number = el('span');
    number.textContent = String(shown);
    counter.append(number);
    button?.append(counter);
    if (!panel || !host || waiting === 0) return;
    const sticky = el('div', 'participants-section-container__sticky-title');
    sticky.append(sectionTitle(`Waiting Room (${waiting})`, true));
    panel.append(
      sticky,
      sectionTitle(`Waiting Room (${waiting})`, true),
      sectionTitle(`In the Meeting (${inMeeting})`, false),
    );
  };

  const frame = (rect: Box): HTMLElement => {
    const element = el('div', 'speaker-active-container__video-frame');
    place(element, rect);
    stageContainer().append(element);
    return element;
  };

  const page: FakeZoomPage = {
    showPreview(rect = { x: 74, y: 186, width: 700, height: 394 }) {
      const root = el('div', 'preview-root');
      const player = el('video-player', 'preview-canvas');
      player.id = 'preview-video-player';
      player.setAttribute('media-type', 'preview');
      player.setAttribute('node-id', 'canvas-preview');
      const canvas = doc.createElement('canvas');
      canvas.width = rect.width;
      canvas.height = rect.height;
      place(player, rect);
      place(canvas, rect);
      player.append(canvas);
      const mute = el('button', 'preview-video__control-button');
      mute.id = 'preview-audio-control-button';
      mute.append(icon('SvgAudioMute'));
      const name = doc.createElement('input');
      name.id = 'input-for-name';
      root.append(player, mute, name, el('button', 'preview-join-button'));
      doc.body.append(root);
    },
    showMeeting(options = {}) {
      stage = options.stage ?? DEFAULT_STAGE;
      scale = options.scale ?? 1;
      const app = el('div', 'meeting-app');
      app.id = 'meeting-app';
      const title = el('span', 'meeting-info-icon__title');
      title.textContent = options.topic ?? '';
      const footer = el('footer', 'footer main-footer');
      footer.id = 'wc-footer';
      const audio = el('button', 'footer-button-base__button join-audio-container__btn');
      const participant = el('div', 'footer__button-wrap');
      participant.id = 'participant';
      participant.append(el('button', 'footer-button-base__button'));
      const leave = el('div', 'footer__leave-btn-container');
      leave.append(el('button', 'footer-button-base__button'));
      footer.append(audio, participant, leave);
      const layout = el('div', 'main-layout');
      layout.append(playerContainer('', stage));
      app.append(title, footer, layout);
      doc.body.append(app);
      host = options.host ?? false;
      waiting = options.waiting ?? 0;
      panelOpen = false;
      page.setAudio(options.audio ?? 'unmuted');
      page.setParticipants(options.participants === undefined ? 1 : options.participants);
    },
    setAudio(audio) {
      doc
        .querySelector('button.join-audio-container__btn')
        ?.replaceChildren(icon(AUDIO_ICON[audio]));
    },
    setParticipants(count) {
      inMeeting = count;
      renderParticipants();
    },
    setWaiting(count) {
      waiting = count;
      renderParticipants();
    },
    showParticipantsPanel() {
      panelOpen = true;
      const panel = el('div', 'participants-section-container');
      doc.querySelector('#meeting-app')?.append(panel);
      renderParticipants();
    },
    addVideoTile(options = {}) {
      const rect = options.rect ?? stage;
      ensureCanvas(stageContainer(), stage);
      const item = el('div');
      item.setAttribute('data-attr', 'video-item-container');
      const player = el('video-player');
      player.setAttribute('node-id', options.nodeId ?? String(16778240 + 1024 * tiles));
      player.setAttribute('media-type', 'video');
      place(player, rect);
      item.append(player);
      const avatar = el('div', 'video-avatar__avatar');
      place(avatar, rect);
      avatar.append(footerName(options.name === undefined ? 'Remote Person' : options.name));
      frame(rect).append(item, avatar);
      tiles++;
      return player;
    },
    addAvatarTile(options = {}) {
      const rect = options.rect ?? stage;
      const avatar = el('div', 'video-avatar__avatar');
      place(avatar, rect);
      const title = el('div', 'video-avatar__avatar-title');
      const name = options.name === undefined ? 'Remote Person' : options.name;
      if (name !== null) {
        const label = el('div', 'video-avatar__avatar-name');
        label.textContent = name;
        title.append(label);
      }
      avatar.append(title, footerName(null));
      frame(rect).append(avatar);
      tiles++;
      return avatar;
    },
    startShare({ rect = stage, nodeId = '16778240' } = {}) {
      const sharee = el('div', 'sharee-container');
      sharee.id = 'sharee-container';
      const container = playerContainer('sharee-container__canvas', rect);
      const player = el('video-player');
      const attributes = { name: 'share-content', 'node-id': nodeId, 'media-type': 'share' };
      for (const [name, value] of Object.entries(attributes)) player.setAttribute(name, value);
      place(player, rect);
      container.append(player);
      ensureCanvas(container, rect);
      sharee.append(container);
      doc.querySelector('#meeting-app')?.append(sharee);
      return player;
    },
    stopShare: () => endShare(doc),
    showLeaveOptions() {
      const options = el('div', 'leave-meeting-options');
      const leave = el('button', 'zmu-btn leave-meeting-options__btn');
      options.append(leave);
      doc.querySelector('#meeting-app')?.append(options);
      return leave;
    },
    stageCanvas: () => stageContainer().shadowRoot?.querySelector('canvas') ?? null,
    place,
  };
  return page;
}
