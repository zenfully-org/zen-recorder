/**
 * Builds a Meet-like tile in happy-dom: a container with data attributes, a <video> whose
 * media properties are configurable, and a name label. Used to test tile discovery/compositing.
 */

export interface FakeVideoTileOptions {
  participantId?: string | null;
  tileMediaId?: string | null;
  name?: string | null;
  self?: boolean;
  videoWidth?: number;
  videoHeight?: number;
  readyState?: number;
  paused?: boolean;
  currentTime?: number;
  rect?: { x: number; y: number; width: number; height: number };
  /** Omit the <video> entirely (e.g. a People-panel row). */
  withoutVideo?: boolean;
  /** Give the <video> `requestVideoFrameCallback`, fired by `newFrame()` (Firefox has it). */
  frameCallbacks?: boolean;
}

export interface FakeVideoTile {
  container: HTMLElement;
  video: HTMLVideoElement | null;
  set(
    patch: Partial<
      Pick<
        FakeVideoTileOptions,
        'currentTime' | 'videoWidth' | 'videoHeight' | 'paused' | 'readyState' | 'rect'
      >
    >,
  ): void;
  /** A new frame is presented: runs the pending frame callbacks. */
  newFrame(): void;
}

export function createFakeVideoTile(
  doc: Document,
  options: FakeVideoTileOptions = {},
): FakeVideoTile {
  const state = {
    videoWidth: options.videoWidth ?? 640,
    videoHeight: options.videoHeight ?? 360,
    readyState: options.readyState ?? 4,
    paused: options.paused ?? false,
    currentTime: options.currentTime ?? 1,
    rect: options.rect ?? { x: 0, y: 0, width: 320, height: 180 },
  };
  const container = doc.createElement('div');
  if (options.participantId !== null) {
    container.dataset['participantId'] = options.participantId ?? 'spaces/x/devices/1';
  }
  if (options.tileMediaId !== null) container.dataset['tileMediaId'] = options.tileMediaId ?? 'm1';
  let video: HTMLVideoElement | null = null;
  let frameCallbacks: (() => void)[] = [];
  if (!options.withoutVideo) {
    video = doc.createElement('video');
    for (const key of [
      'videoWidth',
      'videoHeight',
      'readyState',
      'paused',
      'currentTime',
    ] as const) {
      Object.defineProperty(video, key, { get: () => state[key], configurable: true });
    }
    if (options.frameCallbacks) {
      Object.defineProperty(video, 'requestVideoFrameCallback', {
        value: (callback: () => void) => frameCallbacks.push(callback),
        configurable: true,
      });
    }
    Object.defineProperty(video, 'getBoundingClientRect', {
      value: () => ({ ...state.rect, top: state.rect.y, left: state.rect.x }),
      configurable: true,
    });
    container.appendChild(video);
  }
  if (options.name !== null) {
    const span = doc.createElement('span');
    span.className = 'notranslate';
    span.textContent = options.name ?? 'Remote Person';
    container.appendChild(span);
  }
  if (options.self) {
    const icon = doc.createElement('i');
    icon.className = 'google-symbols';
    icon.textContent = 'frame_person';
    container.appendChild(icon);
  }
  return {
    container,
    video,
    set(patch) {
      Object.assign(state, patch);
    },
    newFrame() {
      const pending = frameCallbacks;
      frameCallbacks = [];
      for (const callback of pending) callback();
    },
  };
}
