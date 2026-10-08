/**
 * Builds Microsoft Teams' call DOM in happy-dom, with the attributes the real page has (verified
 * live in Firefox on 2026-10-01): the pre-join / connecting / lobby screens, the call screen with
 * its toolbar, and stage tiles. Names are invented.
 */
import {
  createFakeVideoTile,
  type FakeVideoTileOptions,
} from '@/test/fakes/create-fake-video-tile';

export type FakeTeamsMic = 'on' | 'off' | 'prohibited';

export interface FakeTeamsTileOptions {
  /** The participant's display name (Teams puts it in `data-tid`). */
  name?: string;
  stream?: 'Video' | 'ScreenSharing';
  /** False: camera off, the tile shows an avatar instead of a `<video>`. */
  camera?: boolean;
  /** The user's own tile: Teams renders no voice outline on it. */
  self?: boolean;
  /** `data-acc-element-id` of the wrapping menu item; null leaves the wrapper out. */
  elementId?: string | null;
  rect?: { x: number; y: number; width: number; height: number };
  video?: Pick<FakeVideoTileOptions, 'videoWidth' | 'videoHeight' | 'currentTime'>;
}

export interface FakeTeamsCallOptions {
  mic?: FakeTeamsMic | null;
  /** Text of the roster badge (participants including the user); null leaves the badge out. */
  roster?: string | null;
  tiles?: FakeTeamsTileOptions[];
}

export interface FakeTeamsPage {
  /** The pre-join screen: camera preview, microphone switch, "Join now". */
  showPrejoin(options?: { micOn?: boolean; preview?: boolean }): HTMLElement;
  showConnecting(): HTMLElement;
  /** The lobby: Teams keeps the pre-join controls inside it. */
  showLobby(options?: { micOn?: boolean }): HTMLElement;
  /** The call screen: toolbar (mic, roster, hang up) and the stage with its tiles. */
  showCall(options?: FakeTeamsCallOptions): HTMLElement;
  /** A stage tile on its own (appended by the caller). */
  createTile(options?: FakeTeamsTileOptions): HTMLElement;
}

let tileCounter = 0;

export function createFakeTeamsPage(doc: Document): FakeTeamsPage {
  const el = (tag: string, attributes: Record<string, string> = {}, children: Node[] = []) => {
    const node = doc.createElement(tag);
    for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value);
    node.append(...children);
    return node;
  };
  const screen = (tid: string, children: Node[] = []) =>
    el('div', { 'data-tid': tid, role: 'region' }, children);
  const withRect = (node: HTMLElement, rect: FakeTeamsTileOptions['rect']) => {
    const box = rect ?? { x: 0, y: 0, width: 320, height: 180 };
    Object.defineProperty(node, 'getBoundingClientRect', {
      value: () => ({ ...box, top: box.y, left: box.x }),
      configurable: true,
    });
    return node;
  };
  const video = (options: FakeTeamsTileOptions = {}) => {
    const fake = createFakeVideoTile(doc, {
      participantId: null,
      tileMediaId: null,
      name: null,
      ...options.video,
      ...(options.rect ? { rect: options.rect } : {}),
    });
    if (!fake.video) throw new Error('the fake tile has no video');
    return fake.video;
  };
  const prejoinControls = (micOn: boolean, preview: boolean) => [
    el('div', { 'data-tid': 'prejoin-v2-video-preview' }, preview ? [video()] : []),
    el('input', {
      role: 'switch',
      type: 'checkbox',
      'data-tid': 'toggle-mute',
      'data-cid': `toggle-mute-${micOn}`,
    }),
    el('button', { id: 'prejoin-join-button', 'data-tid': 'prejoin-join-button' }),
  ];

  const createTile = (options: FakeTeamsTileOptions = {}): HTMLElement => {
    const stream = options.stream ?? 'Video';
    const name = options.name ?? 'Ana Silva';
    const label = el('div');
    label.textContent = name;
    const outline =
      options.self || stream === 'ScreenSharing' ? [] : ['voice-level-stream-outline'];
    const media =
      options.camera === false
        ? el('div', { 'data-tid': 'participant-avatar' }, [el('img')])
        : el('div', { id: 'video-stream-renderer-wrapper' }, [video(options)]);
    const tile = withRect(
      el('div', { 'data-stream-type': stream, 'data-tid': name }, [
        media,
        ...outline.map((tid) => el('div', { 'data-tid': tid })),
        label,
      ]),
      options.rect,
    );
    if (options.elementId === null) return tile;
    return el(
      'div',
      { role: 'menuitem', 'data-acc-element-id': options.elementId ?? `tile-${++tileCounter}` },
      [el('div', { 'data-tid': `video-item-container-${name}` }, [tile])],
    );
  };

  const show = (node: HTMLElement): HTMLElement => {
    doc.body.append(node);
    return node;
  };

  return {
    showPrejoin: ({ micOn = true, preview = true } = {}) =>
      show(screen('calling-prejoin-screen', prejoinControls(micOn, preview))),
    showConnecting: () => show(screen('calling-connecting-screen')),
    showLobby: ({ micOn = true } = {}) =>
      show(screen('calling-lobby-screen', prejoinControls(micOn, true))),
    showCall({ mic = 'on', roster = null, tiles = [] } = {}) {
      const badge = roster === null ? [] : [el('span', { 'data-tid': 'toolbar-item-badge' })];
      for (const node of badge) node.textContent = roster;
      const micButton =
        mic === null
          ? []
          : [
              el('button', { id: 'mic-button' }, [
                el('svg', { 'data-testid': `ubar-mic-${mic}-icon` }),
              ]),
            ];
      return show(
        el('div', { 'data-cid': 'call-screen-wrapper' }, [
          el('button', { id: 'roster-button' }, badge),
          ...micButton,
          el('button', { id: 'hangup-button' }),
          el('div', { 'data-tid': 'modern-stage-wrapper' }, tiles.map(createTile)),
        ]),
      );
    },
    createTile,
  };
}
