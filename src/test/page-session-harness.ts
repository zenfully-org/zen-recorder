/**
 * A page session (`createPageSession`) on a fake meeting page, for its tests: a fake window with
 * Meet's in-call UI, fake WebRTC, MediaRecorder, audio contexts and microphone, the real handshake
 * with a test bridge that records everything the page sends, and the helpers the tests drive it
 * with (join a call, hand out a microphone, send a bridge request).
 */
import { vi } from 'vitest';
import { z } from 'zod';
import type { EncodedChunk } from '@/lib/page/create-media-recorder-encoder';
import { createMixer } from '@/lib/page/create-mixer';
import { createPageMessenger } from '@/lib/page/create-page-messenger';
import { createPageSession, type PageSessionDeps } from '@/lib/page/create-page-session';
import { parsePageLog } from '@/lib/protocol/parse-page-log';
import { parseTabSnapshot } from '@/lib/protocol/parse-tab-snapshot';
import { createMeetProvider } from '@/lib/providers/meet/create-meet-provider';
import type { MeetingProvider } from '@/lib/providers/types';
import type { TabSnapshot, VideoTile } from '@/lib/types';
import { connectTestBridge } from '@/test/connect-test-bridge';
import {
  createFakeAudioContext,
  type FakeAudioContext,
} from '@/test/fakes/create-fake-audio-context';
import {
  createFakeMediaRecorder,
  type FakeMediaRecorderInstance,
} from '@/test/fakes/create-fake-media-recorder';
import {
  createFakeMediaStreamTrack,
  type FakeMediaStreamTrack,
} from '@/test/fakes/create-fake-media-stream-track';
import {
  createFakeRtcPeerConnection,
  type FakeRtcPeerConnection,
} from '@/test/fakes/create-fake-rtc-peer-connection';
import {
  createFakeVideoRecorder,
  type FakeVideoRecorder,
} from '@/test/fakes/create-fake-video-recorder';
import { createFakeWindow } from '@/test/fakes/create-fake-window';

type Win = Window & typeof globalThis;

export interface SessionOptions {
  recorder?: Parameters<typeof createFakeMediaRecorder>[0];
  pathname?: string;
  /** Use the session's built-in encoder/mixer factories (global AudioContext is stubbed). */
  defaultFactories?: boolean;
  /** Inject a video probe result ('reject' makes the probe fail, 'slow' answers after 1 s, 'never' hangs). */
  probe?: { codec: 'vp9' | 'vp8' } | null | 'reject' | 'slow' | 'never';
  videoRecorder?: { throwOnStart?: boolean };
  /** Use the session's real video pipeline instead of the fake recorder. */
  realVideoRecorder?: boolean;
  /** Start without Meet's in-call controls in the DOM (still knocking in the lobby). */
  lobby?: boolean;
  /** Expose WebCodecs globals on the fake window so the default probe runs its real checks. */
  webcodecsGlobals?: boolean;
  /** A provider other than Google Meet (the default, exercised through its real implementation). */
  provider?: MeetingProvider;
  /** How many bytes of unacked chunks a recording may hold (the session's default otherwise). */
  backlogLimitBytes?: number;
  /** What the browser's autoplay policy says about audio contexts (default: allowed). */
  autoplay?: string;
}

/** Meet's in-call UI (leave/captions/chat symbols) is what tells the recorder the user is admitted. */
function admitToMeet(): void {
  const icon = document.createElement('i');
  icon.className = 'google-symbols';
  icon.textContent = 'call_end';
  const tile = document.createElement('div');
  tile.dataset['participantId'] = 'spaces/x/devices/1';
  tile.dataset['tileMediaId'] = 'm1';
  document.body.append(icon, tile);
}

/** The meeting page's window: WebRTC, MediaRecorder, audio contexts and a microphone, all fake. */
function fakeSessionWindow(options: SessionOptions) {
  const fakeWin = createFakeWindow();
  fakeWin.location.pathname = options.pathname ?? '/abc-defg-hij';
  const pcs: FakeRtcPeerConnection[] = [];
  const recorder = createFakeMediaRecorder(options.recorder);
  const audio = createFakeAudioContext();
  /** The options of every AudioContext the built-in factories create. */
  const contextOptions: unknown[] = [];
  const AudioCtor = function (this: unknown, contextOptionsArg: unknown) {
    contextOptions.push(contextOptionsArg);
    return audio;
  } as unknown as typeof AudioContext;
  const autoplay = { policy: options.autoplay ?? 'allowed' };
  /** The tab's real visibility, which the page reads through `Document.prototype`. */
  const visibility = { state: 'visible' };
  class FakeDocument {}
  Object.defineProperty(FakeDocument.prototype, 'visibilityState', { get: () => visibility.state });
  const micTrack = createFakeMediaStreamTrack({ label: 'USB mic' });
  /** Tracks the next getUserMedia calls hand out, before falling back to `micTrack`. */
  const micQueue: FakeMediaStreamTrack[] = [];
  let uuid = 0;
  const win = Object.assign(fakeWin, {
    document: {
      title: 'Standup - Google Meet',
      createElement: document.createElement.bind(document),
      querySelector: document.querySelector.bind(document),
      querySelectorAll: document.querySelectorAll.bind(document),
      addEventListener: document.addEventListener.bind(document),
      removeEventListener: document.removeEventListener.bind(document),
    },
    Document: FakeDocument,
    innerWidth: 1280,
    innerHeight: 720,
    history: { pushState: vi.fn(), replaceState: vi.fn() },
    setInterval: (handler: () => void, ms: number) => setInterval(handler, ms),
    clearInterval: (id: number) => clearInterval(id),
    setTimeout: (handler: () => void, ms: number) => setTimeout(handler, ms),
    clearTimeout: (id: number) => clearTimeout(id),
    performance: { now: () => Date.now() },
    crypto: { randomUUID: () => `4f3c6d2a-9d7c-4a4e-9f1e-0c1b2a3d4e5${uuid++}` },
    RTCPeerConnection: function (this: unknown) {
      const pc = createFakeRtcPeerConnection();
      pcs.push(pc);
      return pc;
    },
    navigator: {
      getAutoplayPolicy: () => autoplay.policy,
      mediaDevices: {
        getUserMedia: vi.fn(
          async () =>
            new MediaStream([(micQueue.shift() ?? micTrack) as unknown as MediaStreamTrack]),
        ),
      },
    },
    MediaRecorder: recorder.Ctor,
    ...(options.defaultFactories ? { AudioContext: AudioCtor } : {}),
    ...(options.webcodecsGlobals ? { VideoEncoder: {}, AudioEncoder: {} } : {}),
  }) as unknown as Win;
  /** The tab goes into the background, or comes to the front again. */
  const setVisibility = (state: 'visible' | 'hidden') => {
    visibility.state = state;
    fakeWin.emit('visibilitychange', new Event('visibilitychange'));
  };
  return {
    win,
    fakeWin,
    pcs,
    recorder,
    audio,
    contextOptions,
    AudioCtor,
    autoplay,
    micTrack,
    micQueue,
    setVisibility,
  };
}

/** The bridge's side of the page's messenger: records everything the page sends and acks chunks. */
function listenAsBridge(win: Win) {
  const bridge = connectTestBridge(win);
  const sent: { type: string; data: unknown }[] = [];
  const snapshots: TabSnapshot[] = [];
  const logs: string[] = [];
  bridge.onMessage('page:ready', () => void sent.push({ type: 'ready', data: undefined }));
  bridge.onMessage('page:snapshot', ({ data }) => {
    const snapshot = parseTabSnapshot(data);
    if (snapshot) snapshots.push(snapshot);
  });
  bridge.onMessage('page:recordingStarted', ({ data }) => {
    sent.push({ type: 'started', data });
  });
  const offChunk = bridge.onMessage('page:chunk', ({ data }) => {
    sent.push({ type: 'chunk', data });
    return { ok: true } as const;
  });
  bridge.onMessage('page:recordingEnded', ({ data }) => {
    sent.push({ type: 'ended', data });
    return { ok: true } as const;
  });
  bridge.onMessage('page:log', ({ data }) => {
    const log = parsePageLog(data);
    if (log) logs.push(`${log.level}: ${log.message}`);
  });
  return { bridge, sent, snapshots, logs, offChunk };
}

/** The probe and the video pipeline a test asks for: fakes unless it wants the real ones. */
function videoDeps(options: SessionOptions) {
  const { probe } = options;
  const videoRecorders: FakeVideoRecorder[] = [];
  const tileFinders: (() => VideoTile[])[] = [];
  const createVideoRecorder = (input: {
    plan: { fps: number };
    findTiles: () => VideoTile[];
    onError: (error: Error) => void;
    onChunk: (chunk: EncodedChunk) => void;
    onLog?: (message: string) => void;
  }) => {
    tileFinders.push(input.findTiles);
    const { onError, onChunk, onLog } = input;
    const recorder = createFakeVideoRecorder(
      { onError, onChunk, fps: input.plan.fps, onLog },
      options.videoRecorder,
    );
    videoRecorders.push(recorder);
    return recorder;
  };
  const probeVideo = () =>
    probe === 'reject'
      ? Promise.reject(new Error('probe crashed'))
      : probe === 'never'
        ? new Promise<never>(() => undefined)
        : probe === 'slow'
          ? new Promise<{ codec: 'vp9' }>((resolve) =>
              setTimeout(() => resolve({ codec: 'vp9' }), 1000),
            )
          : Promise.resolve(probe ?? null);
  const deps =
    probe === undefined
      ? {}
      : { probeVideo, ...(options.realVideoRecorder ? {} : { createVideoRecorder }) };
  return { deps, videoRecorders, tileFinders };
}

/** A page session on a fake meeting page, started by the test, and the helpers to drive it. */
export function setupPageSession(options: SessionOptions = {}) {
  document.body.replaceChildren();
  if (!options.lobby) admitToMeet();
  const page = fakeSessionWindow(options);
  const { win, fakeWin, pcs, recorder, AudioCtor, micTrack, micQueue } = page;
  const listened = listenAsBridge(win);
  const video = videoDeps(options);
  /** The contexts the session keeps open to warm the page's audio graph up. */
  const warmContexts: FakeAudioContext[] = [];
  /** Where the page's screen-share hook reports a screen the browser gave the page. */
  let reportScreen: ((screen: MediaStreamTrack) => void) | null = null;
  const deps: PageSessionDeps = {
    win,
    messenger: createPageMessenger(win),
    provider: options.provider ?? createMeetProvider(),
    readLocation: () => ({
      hostname: 'meet.google.com',
      pathname: fakeWin.location.pathname,
      search: '',
      hash: '',
    }),
    installDisplayMediaHook: (onScreen) => {
      reportScreen = onScreen;
      return () => {
        reportScreen = null;
      };
    },
    ...video.deps,
    ...(options.backlogLimitBytes === undefined
      ? {}
      : { backlogLimitBytes: () => options.backlogLimitBytes ?? 0 }),
    ...(options.defaultFactories
      ? {}
      : {
          createMixer: () => createMixer(document, { AudioContext: AudioCtor }),
          createWarmContext: () => {
            const context = createFakeAudioContext({ initialState: 'suspended' });
            warmContexts.push(context);
            return context;
          },
        }),
  };
  const session = createPageSession(deps);
  if (options.defaultFactories) vi.stubGlobal('AudioContext', AudioCtor);
  const flush = () => vi.advanceTimersByTimeAsync(20);
  const join = async () => {
    const pc = new win.RTCPeerConnection();
    (pc as unknown as FakeRtcPeerConnection).setConnectionState('connected');
    await flush();
    return pcs[pcs.length - 1] as FakeRtcPeerConnection;
  };
  const remote = (pc: FakeRtcPeerConnection, id = 'remote-1') => {
    const track = createFakeMediaStreamTrack({ id });
    pc.emitTrack(track);
    return track;
  };
  /** Joins a call in which someone else is already sending audio. */
  const inCall = async () => {
    remote(await join());
    await flush();
  };
  /** Starts the session, lets it settle, and joins such a call. */
  const startInCall = async () => {
    session.start();
    await flush();
    await inCall();
  };
  const instance = () =>
    recorder.instances[recorder.instances.length - 1] as FakeMediaRecorderInstance;
  /** The page calls getUserMedia and gets `track` (the default microphone when none is given). */
  const acquireMic = async (track: FakeMediaStreamTrack = micTrack) => {
    micQueue.push(track);
    await win.navigator.mediaDevices.getUserMedia({ audio: true });
    await flush();
    return track;
  };
  /** The user shares a screen: the browser gives the page one, as `getDisplayMedia` resolves. */
  const shareScreen = () => {
    const screen = createFakeMediaStreamTrack({ kind: 'video', label: 'screen' });
    reportScreen?.(screen);
    return screen;
  };
  const { bridge } = listened;
  // Fake-window delivery runs on timers, so a request must be flushed to resolve under fake timers.
  const fromBridge = async <K extends 'bridge:command' | 'bridge:configure'>(
    type: K,
    data: Parameters<typeof bridge.sendMessage<K>>[1],
  ) => {
    const promise = bridge.sendMessage(type, data);
    await flush();
    await promise;
  };
  return {
    ...page,
    ...listened,
    session,
    warmContexts,
    flush,
    join,
    remote,
    inCall,
    startInCall,
    instance,
    acquireMic,
    shareScreen,
    fromBridge,
    videoRecorders: video.videoRecorders,
    tileFinders: video.tileFinders,
    admit: admitToMeet,
  };
}

/** Takes every meeting event the page sends, with the recording it belongs to, in order. */
export const takeEvents = (bridge: ReturnType<typeof setupPageSession>['bridge']) => {
  const events: { recordingId: string; type: string; [field: string]: unknown }[] = [];
  bridge.onMessage('page:events', ({ data }) => {
    const batch = z
      .object({ recordingId: z.string(), events: z.array(z.looseObject({ type: z.string() })) })
      .parse(data);
    for (const event of batch.events) events.push({ recordingId: batch.recordingId, ...event });
    return { ok: true, rejected: 0 } as const;
  });
  return events;
};
