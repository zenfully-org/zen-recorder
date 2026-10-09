import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { getAddOnId } from '@/lib/get-add-on-id';
import { parsePageConfig } from '@/lib/protocol/parse-page-config';
import { parsePageLog } from '@/lib/protocol/parse-page-log';
import { parseTabSnapshot } from '@/lib/protocol/parse-tab-snapshot';
import { createMeetProvider } from '@/lib/providers/meet/create-meet-provider';
import type { MeetingProvider } from '@/lib/providers/types';
import type { ChunkMessage, PageConfig, TabSnapshot, VideoTile } from '@/lib/types';
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
import { createFakeMeetingProvider } from '@/test/fakes/create-fake-meeting-provider';
import {
  createFakeRtcPeerConnection,
  type FakeRtcPeerConnection,
} from '@/test/fakes/create-fake-rtc-peer-connection';
import {
  createFakeVideoRecorder,
  type FakeVideoRecorder,
} from '@/test/fakes/create-fake-video-recorder';
import { createFakeWindow } from '@/test/fakes/create-fake-window';
import { registerFakeMediabunnyEncoders } from '@/test/fakes/register-fake-mediabunny-encoders';
import type { EncodedChunk } from './create-media-recorder-encoder';
import { createMixer } from './create-mixer';
import { createPageMessenger } from './create-page-messenger';
import { createPageSession } from './create-page-session';

type Win = Window & typeof globalThis;

/** What the tests read of a chunk the page sent. */
const sentChunk = z.object({ recordingId: z.string(), seq: z.number() });

function setup(
  options: {
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
  } = {},
) {
  // Meet's in-call UI (leave/captions/chat symbols) is what tells the recorder the user is admitted.
  document.body.replaceChildren();
  const admit = () => {
    const icon = document.createElement('i');
    icon.className = 'google-symbols';
    icon.textContent = 'call_end';
    const tile = document.createElement('div');
    tile.dataset['participantId'] = 'spaces/x/devices/1';
    tile.dataset['tileMediaId'] = 'm1';
    document.body.append(icon, tile);
  };
  if (!options.lobby) admit();
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
  /** The contexts the session keeps open to warm the page's audio graph up. */
  const warmContexts: FakeAudioContext[] = [];
  const autoplay = { policy: options.autoplay ?? 'allowed' };
  const micTrack = createFakeMediaStreamTrack({ label: 'USB mic' });
  /** Tracks the next getUserMedia calls hand out, before falling back to `micTrack`. */
  const micQueue: FakeMediaStreamTrack[] = [];
  let uuid = 0;
  const videoRecorders: FakeVideoRecorder[] = [];
  const tileFinders: (() => VideoTile[])[] = [];
  const probe = options.probe;
  const win = Object.assign(fakeWin, {
    document: {
      title: 'Standup - Google Meet',
      createElement: document.createElement.bind(document),
      querySelector: document.querySelector.bind(document),
      querySelectorAll: document.querySelectorAll.bind(document),
      addEventListener: document.addEventListener.bind(document),
      removeEventListener: document.removeEventListener.bind(document),
    },
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

  // Bridge side of the messenger: records everything the page sends and acks chunks.
  const bridge = createPageMessenger(win);
  const sent: { type: string; data: unknown }[] = [];
  const snapshots: TabSnapshot[] = [];
  const logs: string[] = [];
  bridge.onMessage('page:ready', () => {
    sent.push({ type: 'ready', data: undefined });
  });
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
  const pageMessenger = createPageMessenger(win);
  const session = createPageSession({
    win,
    messenger: pageMessenger,
    provider: options.provider ?? createMeetProvider(),
    readLocation: () => ({
      hostname: 'meet.google.com',
      pathname: fakeWin.location.pathname,
      search: '',
      hash: '',
    }),
    ...(probe !== undefined
      ? {
          probeVideo: () =>
            probe === 'reject'
              ? Promise.reject(new Error('probe crashed'))
              : probe === 'never'
                ? new Promise(() => undefined)
                : probe === 'slow'
                  ? new Promise((resolve) => setTimeout(() => resolve({ codec: 'vp9' }), 1000))
                  : Promise.resolve(probe),
          ...(options.realVideoRecorder
            ? {}
            : {
                createVideoRecorder: (input: {
                  plan: { fps: number };
                  findTiles: () => VideoTile[];
                  onError: (error: Error) => void;
                  onChunk: (chunk: EncodedChunk) => void;
                  onLog?: (message: string) => void;
                }) => {
                  tileFinders.push(input.findTiles);
                  const recorder = createFakeVideoRecorder(
                    {
                      onError: input.onError,
                      onChunk: input.onChunk,
                      fps: input.plan.fps,
                      onLog: input.onLog,
                    },
                    options.videoRecorder,
                  );
                  videoRecorders.push(recorder);
                  return recorder;
                },
              }),
        }
      : {}),
    ...(options.backlogLimitBytes === undefined
      ? {}
      : { backlogLimitBytes: () => options.backlogLimitBytes ?? 0 }),
    ...(options.defaultFactories
      ? {}
      : {
          createMixer: () =>
            createMixer(document, { AudioContext: AudioCtor, elementSinks: false }),
          createWarmContext: () => {
            const context = createFakeAudioContext({ initialState: 'suspended' });
            warmContexts.push(context);
            return context;
          },
        }),
  });
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
  const instance = () =>
    recorder.instances[recorder.instances.length - 1] as FakeMediaRecorderInstance;
  /** The page calls getUserMedia and gets `track` (the default microphone when none is given). */
  const acquireMic = async (track: FakeMediaStreamTrack = micTrack) => {
    micQueue.push(track);
    await win.navigator.mediaDevices.getUserMedia({ audio: true });
    await flush();
    return track;
  };
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
    win,
    fakeWin,
    bridge,
    session,
    sent,
    snapshots,
    logs,
    recorder,
    audio,
    contextOptions,
    warmContexts,
    autoplay,
    micTrack,
    pcs,
    flush,
    join,
    remote,
    instance,
    acquireMic,
    offChunk,
    fromBridge,
    videoRecorders,
    tileFinders,
    admit,
  };
}

/** Every test runs on fake timers, from the same moment. */
function useFakeClock(): void {
  vi.useFakeTimers();
  vi.setSystemTime(1_000_000);
}

function useRealClock(): void {
  vi.useRealTimers();
}

beforeEach(useFakeClock);
afterEach(useRealClock);

/** The session started, in a call with a remote participant: a recording runs. */
async function inCall<P>(page: {
  session: { start(): void };
  join(): Promise<P>;
  remote(pc: P): void;
  flush(): Promise<unknown>;
}): Promise<P> {
  page.session.start();
  const pc = await page.join();
  page.remote(pc);
  await page.flush();
  return pc;
}

describe('createPageSession', () => {
  it('reports idle before start and drops remote tracks that end', async () => {
    const { session, flush, join, remote } = setup();
    expect(session.getSnapshot().state).toBe('idle');
    session.start();
    const pc = await join();
    const track = remote(pc);
    await flush();
    expect(session.getSnapshot()).toMatchObject({ remoteTracks: 1, others: 1 });
    track.end();
    await flush();
    expect(session.getSnapshot()).toMatchObject({ state: 'recording', remoteTracks: 0 });
  });

  it('announces readiness and an idle snapshot on start', async () => {
    const { session, sent, snapshots, flush } = setup();
    session.start();
    await flush();
    expect(sent).toEqual([{ type: 'ready', data: undefined }]);
    expect(snapshots.at(-1)).toMatchObject({
      state: 'idle',
      meetingCode: 'abc-defg-hij',
      title: 'Standup',
      connected: false,
      admitted: true,
    });
    expect(session.getSnapshot().state).toBe('idle');
  });

  it('records automatically once a remote participant sends audio, mixing mic and remote', async () => {
    const { win, session, sent, snapshots, audio, micTrack, flush, join, remote, instance } =
      setup();
    session.start();
    const pc = await join();
    expect(session.getSnapshot()).toMatchObject({
      state: 'waiting',
      connected: true,
      admitted: true,
      remoteTracks: 0,
    });
    await win.navigator.mediaDevices.getUserMedia({ audio: true });
    await flush();
    expect(session.getSnapshot().micLabel).toBe('USB mic');
    remote(pc);
    await flush();
    expect(session.getSnapshot()).toMatchObject({ state: 'recording', remoteTracks: 1 });
    const started = sent.find((m) => m.type === 'started');
    expect(started?.data).toMatchObject({
      meetingCode: 'abc-defg-hij',
      title: 'Standup',
      mimeType: 'audio/webm;codecs=opus',
      micLabel: 'USB mic',
      startedAt: expect.any(Number),
    });
    expect(audio.sources).toHaveLength(2);
    expect(micTrack.clones).toHaveLength(1);
    expect(instance().timeslice).toBe(3000);
    expect(snapshots.some((s) => s.state === 'recording')).toBe(true);
  });

  it('delivers chunks in order and reports the end with counts when the call drops', async () => {
    const { session, sent, flush, join, remote, instance } = setup();
    session.start();
    const pc = await join();
    remote(pc);
    await flush();
    const started = sent.find((m) => m.type === 'started');
    if (!started) throw new Error('recording did not start');
    const { startedAt } = started.data as { startedAt: number };
    vi.setSystemTime(startedAt + 3000);
    instance().emitData(10);
    vi.setSystemTime(startedAt + 6000);
    instance().emitData(20);
    await flush();
    const chunks = sent.filter((m) => m.type === 'chunk').map((m) => m.data as ChunkMessage);
    expect(chunks.map((c) => [c.seq, c.blob.size, c.timestampMs])).toEqual([
      [0, 10, 3000],
      [1, 20, 6000],
    ]);
    pc.close();
    await flush();
    expect(session.getSnapshot().state).toBe('recording');
    await vi.advanceTimersByTimeAsync(6000);
    const ended = sent.find((m) => m.type === 'ended');
    expect(ended?.data).toMatchObject({ chunkCount: 2, reason: 'connections-lost' });
    expect(session.getSnapshot().state).toBe('idle');
  });

  it('sends the end of a recording again until the bridge answers that the background has it', async () => {
    const { bridge, session, flush, join, remote, instance } = setup();
    const attempts: unknown[] = [];
    bridge.onMessage('page:recordingEnded', ({ data }) => {
      attempts.push(data);
      // The first one finds the Port down (the event page restarting): the bridge refuses it.
      if (attempts.length === 1) throw new Error('not connected');
      return { ok: true } as const;
    });
    session.start();
    remote(await join());
    await flush();
    instance().emitData(10);
    await flush();
    session.command('stop');
    await flush();
    expect(attempts).toHaveLength(1);
    // With its announcement, which the background may not have either.
    expect(attempts[0]).toMatchObject({ chunkCount: 1, started: { provider: 'meet' } });
    // The page's chunk sender waits 1 s after a refusal, then sends it again.
    await vi.advanceTimersByTimeAsync(1_000);
    await flush();
    expect(attempts).toHaveLength(2);
    expect(attempts[1]).toEqual(attempts[0]);
    // Answered: it is not sent again, and the lifecycle never waited for it.
    await vi.advanceTimersByTimeAsync(60_000);
    expect(attempts).toHaveLength(2);
    expect(session.getSnapshot().state).toBe('waiting');
  });

  it('adds tracks that appear during a recording and drops the mic when it ends', async () => {
    const { win, session, audio, micTrack, flush, join, remote } = setup();
    session.start();
    const pc = await join();
    remote(pc);
    await flush();
    expect(audio.sources).toHaveLength(1);
    remote(pc, 'remote-2');
    await win.navigator.mediaDevices.getUserMedia({ audio: true });
    await flush();
    expect(audio.sources).toHaveLength(3);
    micTrack.end();
    await flush();
    expect(session.getSnapshot().micLabel).toBeNull();
  });

  it('replaces the mic mirror when Meet switches devices mid-recording', async () => {
    const { win, session, micTrack, flush, join, remote } = setup();
    session.start();
    await win.navigator.mediaDevices.getUserMedia({ audio: true });
    remote(await join());
    await flush();
    expect(micTrack.clones).toHaveLength(1);
    const other = createFakeMediaStreamTrack({ label: 'Headset' });
    (win.navigator.mediaDevices.getUserMedia as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      new MediaStream([other as unknown as MediaStreamTrack]),
    );
    await win.navigator.mediaDevices.getUserMedia({ audio: true });
    await flush();
    expect(micTrack.clones[0]?.readyState).toBe('ended');
    expect(other.clones).toHaveLength(1);
    expect(session.getSnapshot().micLabel).toBe('Headset');
    // The old device's track ending later must not clear the new one.
    micTrack.end();
    await flush();
    expect(session.getSnapshot().micLabel).toBe('Headset');
  });

  it('handles pause, resume and stop commands from the bridge', async () => {
    const { session, sent, flush, join, remote, instance, fromBridge } = setup();
    session.start();
    const pc = await join();
    remote(pc);
    await flush();
    await fromBridge('bridge:command', { command: 'pause' });
    expect(instance().state).toBe('paused');
    expect(session.getSnapshot().state).toBe('paused');
    await fromBridge('bridge:command', { command: 'resume' });
    expect(instance().state).toBe('recording');
    await fromBridge('bridge:command', { command: 'stop' });
    await flush();
    expect(sent.find((m) => m.type === 'ended')?.data).toMatchObject({ reason: 'command' });
    expect(session.getSnapshot().state).toBe('waiting');
    // Manual stop suppresses auto-restart in the same meeting.
    remote(pc, 'remote-2');
    await flush();
    expect(session.getSnapshot().state).toBe('waiting');
  });

  it('respects configuration from the bridge (autoRecord off, onJoin rule, bitrate)', async () => {
    const { session, flush, join, remote, instance, fromBridge } = setup();
    session.start();
    const off: PageConfig = {
      autoRecord: false,
      startRule: 'firstRemote',
      audioBitsPerSecond: 32_000,
      timesliceMs: 1000,
      videoMode: 'off',
      videoFps: 15,
      videoHeight: 1080,
      videoBitsPerSecond: 2_500_000,
      videoLabels: true,
      spoofVisibility: false,
    };
    await fromBridge('bridge:configure', off);
    remote(await join());
    await flush();
    expect(session.getSnapshot().state).toBe('waiting');
    session.configure({ ...off, autoRecord: true, startRule: 'onJoin' });
    await flush();
    expect(session.getSnapshot().state).toBe('recording');
    expect(instance().options?.audioBitsPerSecond).toBe(32_000);
    expect(instance().timeslice).toBe(1000);
  });

  it('flushes on pagehide and hands the bridge its end in the same task', async () => {
    const { fakeWin, session, flush, join, remote, instance, bridge } = setup();
    session.start();
    remote(await join());
    await flush();
    const handed: unknown[] = [];
    bridge.onSync('page:handover', ({ data }) => handed.push(data));
    fakeWin.emit('pagehide');
    expect(instance().requestDataCalls).toBe(1);
    expect(handed[0]).toMatchObject({ recordings: [{ end: { reason: 'pagehide' } }] });
  });

  it('stops when navigating away from the meeting route', async () => {
    const { win, session, sent, flush, join, remote } = setup();
    session.start();
    remote(await join());
    await flush();
    win.location.pathname = '/landing';
    win.history.pushState({}, '', '/landing');
    await flush();
    expect(sent.find((m) => m.type === 'ended')?.data).toMatchObject({ reason: 'left-meeting' });
    expect(session.getSnapshot()).toMatchObject({ state: 'idle', meetingCode: null });
  });

  it('retries a recorder that cannot start a bounded number of times, then waits for Record', async () => {
    const { session, sent, logs, recorder, flush, join, remote } = setup({
      recorder: { throwOnStart: true },
    });
    session.start();
    remote(await join());
    await flush();
    expect(logs.filter((l) => l.includes('failed to start recorder'))).toHaveLength(4);
    expect(logs).toContain(
      'warn: encoder failed 4 times in a row: not restarting until Record is pressed or another meeting starts',
    );
    expect(recorder.instances).toHaveLength(4);
    expect(sent.find((m) => m.type === 'started')).toBeUndefined();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(recorder.instances).toHaveLength(4);
    expect(session.getSnapshot().state).toBe('waiting');
  });

  it('restarts the recording when the audio encoder reports an error, without a manual stop', async () => {
    const { session, sent, logs, recorder, flush, join, remote, instance } = setup();
    session.start();
    remote(await join());
    await flush();
    instance().emitData(5);
    instance().emitError(new Error('disk full'));
    await flush();
    expect(logs).toContainEqual('error: encoder error: disk full');
    expect(sent.filter((m) => m.type === 'ended').map((m) => m.data)).toEqual([
      expect.objectContaining({ reason: 'encoder-error', chunkCount: 1 }),
    ]);
    expect(sent.filter((m) => m.type === 'started')).toHaveLength(2);
    expect(recorder.instances).toHaveLength(2);
    expect(session.getSnapshot().state).toBe('recording');
  });

  it('records nothing after a failure while paused: the next recording starts on Resume', async () => {
    const { session, sent, logs, recorder, flush, join, remote, instance, fromBridge } = setup();
    session.start();
    remote(await join());
    await flush();
    await fromBridge('bridge:command', { command: 'pause' });
    instance().emitData(5);
    instance().emitError(new Error('disk full'));
    await flush();
    expect(sent.filter((m) => m.type === 'ended').map((m) => m.data)).toEqual([
      expect.objectContaining({ reason: 'encoder-error', chunkCount: 1 }),
    ]);
    expect(logs).toContain('info: paused: the next recording starts on Resume');
    expect(session.getSnapshot()).toMatchObject({
      state: 'paused',
      recordingId: null,
      recordingStartedAt: null,
    });
    await vi.advanceTimersByTimeAsync(5_000);
    expect(recorder.instances).toHaveLength(1);
    expect(sent.filter((m) => m.type === 'started')).toHaveLength(1);
    await fromBridge('bridge:command', { command: 'resume' });
    expect(recorder.instances).toHaveLength(2);
    expect(instance().state).toBe('recording');
    expect(sent.filter((m) => m.type === 'started')).toHaveLength(2);
    expect(session.getSnapshot()).toMatchObject({
      state: 'recording',
      recordingId: expect.any(String),
    });
  });

  it.each([
    ['Stop', 'waiting'],
    ['leaving the meeting', 'idle'],
  ] as const)(
    'saves nothing more when a paused restart ends by %s before Resume',
    async (end, after) => {
      const { session, sent, recorder, flush, join, remote, instance, fakeWin, win } = setup();
      session.start();
      const pc = await join();
      remote(pc);
      await flush();
      session.command('pause');
      instance().emitError(new Error('disk full'));
      await flush();
      if (end === 'Stop') session.command('stop');
      if (end === 'leaving the meeting') {
        pc.close();
        fakeWin.location.pathname = '/landing';
        win.history.pushState({}, '', '/landing');
      }
      await vi.advanceTimersByTimeAsync(1_000);
      expect(recorder.instances).toHaveLength(1);
      expect(sent.filter((m) => m.type === 'ended')).toHaveLength(1);
      expect(session.getSnapshot()).toMatchObject({ state: after, recordingId: null });
    },
  );

  it('retries a start that fails on Resume like any other failed start', async () => {
    const { session, logs, recorder, flush, join, remote, instance, fromBridge } = setup();
    session.start();
    remote(await join());
    await flush();
    await fromBridge('bridge:command', { command: 'pause' });
    instance().emitError(new Error('disk full'));
    await flush();
    recorder.failStarts(1);
    await fromBridge('bridge:command', { command: 'resume' });
    await flush();
    expect(logs.filter((l) => l.includes('failed to start recorder'))).toHaveLength(1);
    // The recorder that failed, the one that could not start, and the one that runs.
    expect(recorder.instances).toHaveLength(3);
    expect(instance().state).toBe('recording');
    expect(session.getSnapshot().state).toBe('recording');
  });

  it.each([
    ['pause', 'paused', 1],
    ['resume', 'recording', 2],
  ] as const)(
    'honours a %s pressed while the failed recorder stops: it comes back %s',
    async (command, after, recorders) => {
      const { session, flush, join, remote, instance, recorder } = setup();
      session.start();
      remote(await join());
      await flush();
      if (command === 'resume') session.command('pause');
      instance().emitError(new Error('disk full'));
      expect(session.getSnapshot().state).toBe('stopping');
      session.command(command);
      await flush();
      expect(recorder.instances).toHaveLength(recorders);
      expect(session.getSnapshot().state).toBe(after);
    },
  );

  it('honours a Stop pressed while the failed recorder stops: no new recording', async () => {
    const { session, sent, flush, join, remote, instance, recorder } = setup();
    session.start();
    const pc = await join();
    remote(pc);
    await flush();
    instance().emitError(new Error('disk full'));
    session.command('stop');
    await flush();
    expect(recorder.instances).toHaveLength(1);
    expect(sent.filter((m) => m.type === 'ended').map((m) => m.data)).toEqual([
      expect.objectContaining({ reason: 'encoder-error' }),
    ]);
    expect(session.getSnapshot().state).toBe('waiting');
    // A manual stop: no auto-start in this meeting.
    remote(pc, 'remote-2');
    await vi.advanceTimersByTimeAsync(2_000);
    expect(recorder.instances).toHaveLength(1);
  });

  it('gives up on an encoder that keeps failing: four files at most, then Record starts again', async () => {
    const { session, sent, logs, flush, join, remote, instance } = setup();
    session.start();
    remote(await join());
    await flush();
    for (let attempt = 0; attempt < 6; attempt++) {
      instance().emitData(5);
      instance().emitError(new Error('encoder crashed'));
      await flush();
    }
    const ended = sent.filter((m) => m.type === 'ended').map((m) => m.data);
    expect(ended).toEqual(Array(4).fill(expect.objectContaining({ reason: 'encoder-error' })));
    expect(sent.filter((m) => m.type === 'started')).toHaveLength(4);
    expect(logs).toContain(
      'warn: encoder failed 4 times in a row: not restarting until Record is pressed or another meeting starts',
    );
    await vi.advanceTimersByTimeAsync(10_000);
    expect(session.getSnapshot().state).toBe('waiting');
    expect(sent.filter((m) => m.type === 'started')).toHaveLength(4);
    session.command('start');
    await flush();
    expect(sent.filter((m) => m.type === 'started')).toHaveLength(5);
    expect(session.getSnapshot().state).toBe('recording');
  });

  it('resumes the audio context if the browser suspends it', async () => {
    const { session, audio, flush, join, remote } = setup();
    session.start();
    remote(await join());
    await flush();
    audio.suspendByPolicy();
    expect(audio.resumeCalls).toBeGreaterThan(0);
  });

  it('only publishes snapshots when something changed, plus every tick when it did', async () => {
    const { session, snapshots, flush } = setup();
    session.start();
    await flush();
    const count = snapshots.length;
    await vi.advanceTimersByTimeAsync(3000);
    expect(snapshots).toHaveLength(count);
  });

  it('ignores a stop effect when nothing is recording and disposes cleanly', async () => {
    const { fakeWin, session, flush, join } = setup();
    session.start();
    await join();
    session.command('stop');
    await flush();
    expect(session.getSnapshot().state).toBe('waiting');
    session.dispose();
    expect(vi.getTimerCount()).toBe(0);
    expect(fakeWin.listeners.get('pagehide')?.size).toBe(0);
  });

  it('records with the built-in MediaRecorder encoder and mixer factories', async () => {
    const { session, sent, audio, flush, join, remote, instance } = setup({
      defaultFactories: true,
    });
    session.start();
    remote(await join());
    await flush();
    expect(session.getSnapshot().state).toBe('recording');
    expect(audio.sources).toHaveLength(1);
    instance().emitData(5);
    await flush();
    expect(sent.some((m) => m.type === 'chunk')).toBe(true);
    vi.unstubAllGlobals();
  });

  it('warms the audio graph up with the options of the mixer context, so the mixer joins that graph', async () => {
    // Firefox runs one audio graph per window, sample rate and output device: a context of
    // another rate would warm another graph and leave the mixer's cold.
    const { session, contextOptions, flush, join, remote } = setup({ defaultFactories: true });
    session.start();
    expect(contextOptions).toEqual([{ sampleRate: 48_000, latencyHint: 'playback' }]);
    remote(await join());
    await flush();
    expect(session.getSnapshot().state).toBe('recording');
    expect(contextOptions).toHaveLength(2);
    expect(contextOptions[1]).toEqual(contextOptions[0]);
    vi.unstubAllGlobals();
  });

  it('records alone when started by hand, without connections, until a call is joined and dropped', async () => {
    const { session, sent, flush, join, remote, instance } = setup();
    session.start();
    session.command('start');
    await flush();
    expect(session.getSnapshot().state).toBe('recording');
    await vi.advanceTimersByTimeAsync(30_000);
    expect(session.getSnapshot().state).toBe('recording');
    expect(sent.find((m) => m.type === 'ended')).toBeUndefined();
    // Joining later adds the remote audio into the running recording.
    const pc = await join();
    remote(pc);
    await flush();
    expect(session.getSnapshot()).toMatchObject({ state: 'recording', remoteTracks: 1 });
    instance().emitData(5);
    await flush();
    // Now that a connection existed, losing it ends the recording after the grace period.
    pc.close();
    await vi.advanceTimersByTimeAsync(6000);
    expect(sent.find((m) => m.type === 'ended')?.data).toMatchObject({
      reason: 'connections-lost',
    });
  });

  it('labels the meeting "unknown" when recording is started by hand outside a meeting route', async () => {
    const { session, sent, flush } = setup({ pathname: '/landing' });
    session.start();
    session.command('start');
    await flush();
    expect(sent.find((m) => m.type === 'started')?.data).toMatchObject({
      meetingCode: 'unknown',
      title: 'Standup',
    });
    expect(session.getSnapshot().state).toBe('recording');
  });
});

describe('createPageSession lobby', () => {
  it('waits for admission before auto-recording, even with remote tracks', async () => {
    const { session, flush, join, remote, admit } = setup({ lobby: true });
    await inCall({ session, join, remote, flush });
    expect(session.getSnapshot()).toMatchObject({ state: 'waiting', admitted: false });
    admit();
    await vi.advanceTimersByTimeAsync(1000);
    expect(session.getSnapshot()).toMatchObject({ state: 'recording', admitted: true });
    expect(session.debug()).toMatchObject({
      connections: 1,
      admitted: true,
      remoteAudioTracks: [{ id: 'remote-1', enabled: true, readyState: 'live' }],
    });
  });
});

describe('createPageSession reload safety', () => {
  it('re-announces the active recording when a bridge configures the page', async () => {
    const { session, sent, flush, join, remote } = setup();
    await inCall({ session, join, remote, flush });
    const started = () => sent.filter((m) => m.type === 'started').map((m) => m.data);
    expect(started()).toHaveLength(1);
    session.configure(parsePageConfig(undefined));
    await flush();
    expect(started()).toHaveLength(2);
    expect(started()[1]).toEqual(started()[0]);
    session.command('stop');
    await flush();
    session.configure(parsePageConfig(undefined));
    await flush();
    expect(started()).toHaveLength(2);
  });
});

describe('createPageSession video', () => {
  const started = (sent: { type: string; data: unknown }[]) =>
    sent.filter((m) => m.type === 'started').map((m) => m.data as Record<string, unknown>);

  it('records video when the probe finds an encoder and reports tiles in the snapshot', async () => {
    const { session, sent, flush, join, remote, videoRecorders, logs } = setup({
      probe: { codec: 'vp9' },
    });
    session.start();
    await flush();
    remote(await join());
    await flush();
    expect(videoRecorders).toHaveLength(1);
    expect(started(sent)[0]).toMatchObject({
      hasVideo: true,
      mimeType: 'video/webm;codecs=vp9,opus',
    });
    expect(session.getSnapshot()).toMatchObject({ state: 'recording', videoTiles: 3 });
    expect(logs).toContainEqual(
      'info: recording started (video/webm;codecs=vp9,opus, video 1920x1080@15)',
    );
    expect(logs).toContain('info: audio tap: fake');
    session.command('stop');
    await flush();
    expect(videoRecorders[0]?.calls).toEqual(['start', 'stop']);
    expect(videoRecorders[0]?.disposed).toBe(true);
    expect(session.getSnapshot().videoTiles).toBeUndefined();
  });

  it('keeps only the latest probe result when the configuration changes quickly', async () => {
    const { session, sent, flush, join, remote, videoRecorders } = setup({
      probe: { codec: 'vp9' },
    });
    session.start();
    // Two probes in flight: the older one must not overwrite the newer result.
    session.configure({ ...parsePageConfig(undefined), videoHeight: 720 });
    await flush();
    remote(await join());
    await flush();
    expect(videoRecorders).toHaveLength(1);
    expect(started(sent)[0]).toMatchObject({ hasVideo: true });
  });

  it('records audio-only when the real video pipeline cannot be built in this page', async () => {
    const { session, sent, flush, join, remote, logs } = setup({
      probe: { codec: 'vp9' },
      realVideoRecorder: true,
    });
    session.start();
    await flush();
    remote(await join());
    await flush();
    await vi.advanceTimersByTimeAsync(500);
    expect(session.getSnapshot().state).toBe('recording');
    expect(started(sent).at(-1)).toMatchObject({ mimeType: 'audio/webm;codecs=opus' });
    expect(logs.some((l) => l.startsWith('error: video'))).toBe(true);
  });

  it('waits for a slow initial probe before starting, then records video', async () => {
    const { session, sent, flush, join, remote, videoRecorders, logs } = setup({ probe: 'slow' });
    await inCall({ session, join, remote, flush });
    expect(session.getSnapshot().state).toBe('recording');
    expect(started(sent)).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1100);
    expect(started(sent)[0]).toMatchObject({ hasVideo: true });
    expect(videoRecorders).toHaveLength(1);
    // The 'slow' probe answers after 1 s; the line says how long it took.
    expect(logs).toContain('info: video probe: vp9 (1000 ms)');
  });

  it('gives up on a probe that never answers and records audio-only', async () => {
    const { session, sent, flush, join, remote, videoRecorders } = setup({ probe: 'never' });
    await inCall({ session, join, remote, flush });
    await vi.advanceTimersByTimeAsync(2100);
    expect(started(sent)[0]).toMatchObject({ mimeType: 'audio/webm;codecs=opus' });
    expect(videoRecorders).toHaveLength(0);
  });

  it('does not start a recording that was stopped while waiting for the probe', async () => {
    const { session, sent, flush, join, remote } = setup({ probe: 'slow' });
    await inCall({ session, join, remote, flush });
    session.command('stop');
    await flush();
    await vi.advanceTimersByTimeAsync(3000);
    expect(started(sent)).toHaveLength(0);
    expect(session.getSnapshot().state).toBe('waiting');
  });

  it('starts the recording on Resume when Pause was pressed while the start waited for the probe', async () => {
    const { session, sent, logs, flush, join, remote, videoRecorders, fromBridge } = setup({
      probe: 'slow',
    });
    await inCall({ session, join, remote, flush });
    await fromBridge('bridge:command', { command: 'pause' });
    await vi.advanceTimersByTimeAsync(1100);
    expect(started(sent)).toHaveLength(0);
    expect(videoRecorders).toHaveLength(0);
    expect(logs).toContain('info: paused: the next recording starts on Resume');
    expect(session.getSnapshot()).toMatchObject({ state: 'paused', recordingId: null });
    await fromBridge('bridge:command', { command: 'resume' });
    expect(started(sent)).toHaveLength(1);
    expect(started(sent)[0]).toMatchObject({ hasVideo: true });
    expect(videoRecorders[0]?.calls).toEqual(['start']);
    expect(session.getSnapshot().state).toBe('recording');
  });

  it('installs the visibility spoof around a video recording when configured', async () => {
    const { session, win, flush, join, remote, fromBridge } = setup({ probe: { codec: 'vp9' } });
    session.start();
    await fromBridge('bridge:configure', { spoofVisibility: true } as unknown as PageConfig);
    remote(await join());
    await flush();
    expect(Object.getOwnPropertyDescriptor(win.document, 'hidden')).toBeDefined();
    expect(win.document.hidden).toBe(false);
    expect(win.document.visibilityState).toBe('visible');
    session.command('stop');
    await flush();
    expect(Object.getOwnPropertyDescriptor(win.document, 'hidden')).toBeUndefined();
  });

  it.each([
    ['no encoder is available', null],
    ['the probe fails', 'reject' as const],
  ])('records audio-only when %s', async (_label, probe) => {
    const { session, sent, flush, join, remote, videoRecorders, logs } = setup({ probe });
    session.start();
    await flush();
    remote(await join());
    await flush();
    expect(videoRecorders).toHaveLength(0);
    expect(started(sent)[0]).toMatchObject({ mimeType: 'audio/webm;codecs=opus' });
    expect(started(sent)[0]?.['hasVideo']).toBeUndefined();
    if (probe === 'reject')
      expect(logs).toContain('warn: video probe failed: Error: probe crashed');
  });

  it('runs the real encode probe when WebCodecs globals exist (audio-only when it fails)', async () => {
    // Registered fake encoders make Mediabunny's test encodes pass, so the probe returns a plan;
    // the real video pipeline then fails to build under happy-dom (no 2D canvas) → audio-only.
    registerFakeMediabunnyEncoders();
    const { session, sent, flush, join, remote } = setup({ webcodecsGlobals: true });
    session.start();
    await flush();
    remote(await join());
    await flush();
    // Under Vitest there is no VideoEncoder, so Mediabunny's test encode reports "cannot encode".
    expect(started(sent)[0]).toMatchObject({ mimeType: 'audio/webm;codecs=opus' });
  });

  it('records audio-only when video is switched off', async () => {
    const { session, sent, flush, join, remote, videoRecorders, fromBridge } = setup({
      probe: { codec: 'vp9' },
    });
    session.start();
    await fromBridge('bridge:configure', { videoMode: 'off' } as unknown as PageConfig);
    remote(await join());
    await flush();
    expect(videoRecorders).toHaveLength(0);
    expect(started(sent)[0]).toMatchObject({ mimeType: 'audio/webm;codecs=opus' });
  });

  it('continues audio-only for the rest of the meeting after a video encoder failure', async () => {
    const { session, sent, flush, join, remote, videoRecorders, logs } = setup({
      probe: { codec: 'vp9' },
    });
    session.start();
    await flush();
    remote(await join());
    await flush();
    videoRecorders[0]?.fail(new Error('gpu reset'));
    await flush();
    expect(logs).toContain('error: video encoder error: gpu reset; continuing audio-only');
    const ended = sent.find((m) => m.type === 'ended')?.data as { reason: string };
    expect(ended.reason).toBe('encoder-error');
    expect(started(sent)).toHaveLength(2);
    expect(started(sent)[1]?.['hasVideo']).toBeUndefined();
    expect(session.getSnapshot()).toMatchObject({ state: 'recording' });
    expect(videoRecorders).toHaveLength(1);
  });

  it('records audio only at once after a video encoder failure while the extension takes no chunks, and delivers the failed recording whole later', async () => {
    const { session, sent, flush, join, remote, videoRecorders, offChunk, bridge, instance } =
      setup({ probe: { codec: 'vp9' } });
    session.start();
    await flush();
    remote(await join());
    await flush();
    const first = session.getSnapshot().recordingId;
    // The extension takes no chunks for now (its background restarting, a reload, a store that hangs).
    offChunk();
    for (let seq = 0; seq < 3; seq++) videoRecorders[0]?.emitData(1000);
    // Handed out again, as after a flush Firefox stopped short: sent and counted once.
    videoRecorders[0]?.emitAgain();
    await flush();
    videoRecorders[0]?.fail(new Error('gpu reset'));
    await flush();
    // The audio-only recording starts beside the failed one's chunks, without waiting for them.
    expect(started(sent)).toHaveLength(2);
    expect(started(sent)[1]?.['hasVideo']).toBeUndefined();
    expect(session.getSnapshot()).toMatchObject({ state: 'recording' });
    expect(session.getSnapshot().recordingId).not.toBe(first);
    instance().emitData(100);
    await flush();
    expect(session.debug().backlog).toEqual({ bytes: 100, chunks: 1 });
    // The extension is back: the video recording arrives whole and in order, then its end.
    bridge.onMessage('page:chunk', ({ data }) => {
      sent.push({ type: 'chunk', data });
      return { ok: true } as const;
    });
    await vi.advanceTimersByTimeAsync(20_000);
    const seqs = sent
      .filter((m) => m.type === 'chunk')
      .map((m) => sentChunk.parse(m.data))
      .filter((c) => c.recordingId === first)
      .map((c) => c.seq);
    expect(seqs).toEqual([0, 1, 2]);
    expect(sent.filter((m) => m.type === 'ended').map((m) => m.data)).toEqual([
      expect.objectContaining({ recordingId: first, reason: 'encoder-error', chunkCount: 3 }),
    ]);
  });

  it('ignores a full backlog of a recording that is already stopping', async () => {
    const MiB = 2 ** 20;
    const { session, sent, logs, flush, join, remote, videoRecorders, offChunk, fromBridge } =
      setup({ probe: { codec: 'vp9' }, backlogLimitBytes: 2 * MiB });
    session.start();
    await flush();
    remote(await join());
    await flush();
    offChunk();
    videoRecorders[0]?.emitData(MiB);
    await fromBridge('bridge:command', { command: 'stop' });
    // The encoder's last chunks come while it stops.
    videoRecorders[0]?.emitData(MiB);
    videoRecorders[0]?.emitData(MiB);
    await flush();
    expect(logs.filter((line) => line.includes('backlog full'))).toEqual([]);
    expect(started(sent)).toHaveLength(1);
    expect(session.getSnapshot()).toMatchObject({ state: 'waiting', recordingId: null });
  });

  it('records nothing after a video encoder failure while paused, then audio-only on Resume', async () => {
    const { session, sent, flush, join, remote, videoRecorders, instance, recorder, fromBridge } =
      setup({ probe: { codec: 'vp9' } });
    session.start();
    await flush();
    remote(await join());
    await flush();
    await fromBridge('bridge:command', { command: 'pause' });
    videoRecorders[0]?.fail(new Error('gpu reset'));
    await flush();
    expect(started(sent)).toHaveLength(1);
    expect(recorder.instances).toHaveLength(0);
    expect(session.getSnapshot()).toMatchObject({ state: 'paused', recordingId: null });
    await fromBridge('bridge:command', { command: 'resume' });
    expect(started(sent)).toHaveLength(2);
    expect(started(sent)[1]?.['hasVideo']).toBeUndefined();
    expect(instance().state).toBe('recording');
    expect(videoRecorders).toHaveLength(1);
  });

  it('ignores a late error from the video pipeline it already replaced', async () => {
    const { session, sent, flush, join, remote, videoRecorders } = setup({
      probe: { codec: 'vp9' },
    });
    session.start();
    await flush();
    remote(await join());
    await flush();
    videoRecorders[0]?.fail(new Error('gpu reset'));
    await flush();
    videoRecorders[0]?.fail(new Error('frame after close'));
    await flush();
    expect(sent.filter((m) => m.type === 'ended')).toHaveLength(1);
    expect(started(sent)).toHaveLength(2);
    expect(session.getSnapshot().state).toBe('recording');
  });

  it('falls back to audio-only immediately when the video encoder cannot start', async () => {
    const { session, sent, flush, join, remote, videoRecorders, logs } = setup({
      probe: { codec: 'vp9' },
      videoRecorder: { throwOnStart: true },
    });
    session.start();
    await flush();
    remote(await join());
    await flush();
    expect(videoRecorders).toHaveLength(1);
    expect(videoRecorders[0]?.disposed).toBe(true);
    expect(logs).toContainEqual(
      expect.stringContaining('error: failed to start recorder: Error: no canvas'),
    );
    expect(started(sent)).toHaveLength(1);
    expect(started(sent)[0]).toMatchObject({ mimeType: 'audio/webm;codecs=opus' });
    expect(session.getSnapshot().state).toBe('recording');
  });

  it('lowers the frame rate when the pipeline overloads the page and raises it when the load allows', async () => {
    const { session, flush, join, remote, videoRecorders, logs } = setup({
      probe: { codec: 'vp9' },
    });
    session.start();
    await flush();
    remote(await join());
    await flush();
    const [recorder] = videoRecorders;
    if (!recorder) throw new Error('no video recorder');
    const light = { ...recorder.load, encodedPerS: 15, ticksPerS: 15, mainMsPerFrame: 10 };
    recorder.load = { ...light, mainMsPerFrame: 40, mainMsPerS: 600 };
    // The first five seconds only fill the window the decision reads.
    await vi.advanceTimersByTimeAsync(4_000);
    expect(recorder.fps()).toBe(15);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(recorder.fps()).toBe(7.5);
    expect(recorder.loadWindows.at(-1)).toBe(5_000);
    expect(logs).toContain(
      'warn: video rate lowered to 7.5 fps: compositing takes 600 ms/s of the main thread (40 ms per frame)',
    );
    // Lighter again: it goes back up once the hold time (doubled by the step down) has passed.
    recorder.load = { ...light, mainMsPerS: 80 };
    await vi.advanceTimersByTimeAsync(30_000);
    expect(recorder.fps()).toBe(7.5);
    await vi.advanceTimersByTimeAsync(12_000);
    expect(recorder.fps()).toBe(15);
    expect(logs).toContain('info: video rate raised to 15 fps: the load allows a higher rate');
  });

  it('leaves the frame rate alone while the recording is paused', async () => {
    const { session, flush, join, remote, videoRecorders, fromBridge } = setup({
      probe: { codec: 'vp9' },
    });
    session.start();
    await flush();
    remote(await join());
    await flush();
    const [recorder] = videoRecorders;
    if (!recorder) throw new Error('no video recorder');
    await fromBridge('bridge:command', { command: 'pause' });
    recorder.load = { ...recorder.load, mainMsPerFrame: 40, mainMsPerS: 600 };
    await vi.advanceTimersByTimeAsync(10_000);
    expect(recorder.fps()).toBe(15);
    expect(recorder.loadWindows).toEqual([]);
  });

  it('reports what the video pipeline costs: in debug, a minute in, every ten minutes and at the end', async () => {
    const { session, flush, join, remote, videoRecorders, logs, fromBridge } = setup({
      probe: { codec: 'vp9' },
    });
    session.start();
    await flush();
    remote(await join());
    await flush();
    const [recorder] = videoRecorders;
    if (!recorder) throw new Error('no video recorder');
    recorder.snapshot = { ...recorder.snapshot, encoded: 900, ticks: 900 };
    expect(session.debug().video).toMatchObject({ fps: 15, encoded: 900, ticks: 900 });
    const perf = () => logs.filter((line) => line.startsWith('info: video perf'));
    await vi.advanceTimersByTimeAsync(59_000);
    expect(perf()).toEqual([]);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(perf()).toHaveLength(1);
    expect(perf()[0]).toMatch(
      /^info: video perf after 6\d s: 1\d\.\d frames\/s encoded \(target 15\/15 fps\)/,
    );
    await vi.advanceTimersByTimeAsync(590_000);
    expect(perf()).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(perf()).toHaveLength(2);
    await fromBridge('bridge:command', { command: 'stop' });
    await flush();
    expect(perf()).toHaveLength(3);
    expect(session.debug().video).toBeNull();
  });

  it('re-enables video in the next meeting after a failure', async () => {
    const { session, sent, flush, join, remote, videoRecorders, fakeWin, win } = setup({
      probe: { codec: 'vp9' },
    });
    session.start();
    await flush();
    const pc = await join();
    remote(pc);
    await flush();
    videoRecorders[0]?.fail(new Error('gpu reset'));
    await flush();
    expect(started(sent)).toHaveLength(2);
    pc.close();
    fakeWin.location.pathname = '/landing';
    win.history.pushState({}, '', '/landing');
    await flush();
    await vi.advanceTimersByTimeAsync(6000);
    fakeWin.location.pathname = '/xyz-abcd-efg';
    win.history.pushState({}, '', '/xyz-abcd-efg');
    const pc2 = await join();
    remote(pc2, 'remote-2');
    await flush();
    expect(started(sent)).toHaveLength(3);
    expect(started(sent)[2]).toMatchObject({ hasVideo: true });
  });
});

describe('createPageSession providers', () => {
  it('reports the provider, meeting id and title the provider reads from the page', async () => {
    const { provider } = createFakeMeetingProvider({ meetingId: '86412345678', title: 'Planning' });
    const { session, sent, snapshots, flush, join, remote } = setup({ provider });
    session.start();
    remote(await join());
    await flush();
    expect(snapshots.at(-1)).toMatchObject({
      state: 'recording',
      provider: 'zoom',
      meetingCode: '86412345678',
      title: 'Planning',
    });
    expect(sent.find((m) => m.type === 'started')?.data).toMatchObject({
      provider: 'zoom',
      meetingCode: '86412345678',
      title: 'Planning',
    });
  });

  it('follows a meeting that only shows in the page, without any navigation', async () => {
    const { provider, page } = createFakeMeetingProvider({ meetingId: null, admitted: false });
    const { session, sent, flush, join, remote } = setup({ provider });
    session.start();
    remote(await join());
    await flush();
    expect(session.getSnapshot()).toMatchObject({ state: 'idle', meetingCode: null });

    page.meeting = { ...page.meeting, meetingId: 'call-7', admitted: true, title: 'Renamed' };
    await vi.advanceTimersByTimeAsync(1_000);
    expect(session.getSnapshot()).toMatchObject({
      state: 'recording',
      meetingCode: 'call-7',
      title: 'Renamed',
    });

    page.meeting = { ...page.meeting, meetingId: null, admitted: false };
    await vi.advanceTimersByTimeAsync(1_000);
    expect(sent.find((m) => m.type === 'ended')?.data).toMatchObject({ reason: 'left-meeting' });
  });

  it('picks up a new title on the next tick without touching the lifecycle', async () => {
    const { provider, page } = createFakeMeetingProvider();
    const { session, snapshots, flush } = setup({ provider });
    session.start();
    await flush();
    page.meeting = { ...page.meeting, title: 'Retro' };
    await vi.advanceTimersByTimeAsync(1_000);
    expect(snapshots.at(-1)).toMatchObject({ state: 'idle', title: 'Retro' });
  });

  it('names a recording started before the first tick by what the page shows at that moment', async () => {
    // At document_start the tab has no title yet; "Record" can be clicked within the first second.
    const { provider, page } = createFakeMeetingProvider({ title: 'call-1' });
    const { session, sent, flush, fromBridge } = setup({ provider });
    session.start();
    page.meeting = { ...page.meeting, title: 'Fixture call' };
    await fromBridge('bridge:command', { command: 'start' });
    await flush();
    expect(sent.find((m) => m.type === 'started')?.data).toMatchObject({ title: 'Fixture call' });
    expect(session.getSnapshot().title).toBe('Fixture call');
  });

  it("lets the provider's participant count decide when someone else is there", async () => {
    const { provider, page } = createFakeMeetingProvider({ remoteParticipants: 0 });
    const { session, flush, join, remote } = setup({ provider });
    session.start();
    // The service hands out audio tracks as soon as the call connects, with nobody else in it.
    remote(await join());
    await flush();
    expect(session.getSnapshot()).toMatchObject({ state: 'waiting', remoteTracks: 1, others: 0 });
    page.meeting = { ...page.meeting, remoteParticipants: 1 };
    await vi.advanceTimersByTimeAsync(1_000);
    expect(session.getSnapshot()).toMatchObject({ state: 'recording', others: 1 });
  });

  it('silences the recorded microphone while the page shows it muted', async () => {
    const { provider, page } = createFakeMeetingProvider();
    page.micMuted = true;
    const { win, session, micTrack, flush, join, remote } = setup({ provider });
    session.start();
    remote(await join());
    await win.navigator.mediaDevices.getUserMedia({ audio: true });
    await flush();
    expect(micTrack.enabled).toBe(true);
    expect(micTrack.clones.at(-1)?.enabled).toBe(false);
    page.micMuted = false;
    await vi.advanceTimersByTimeAsync(250);
    expect(micTrack.clones.at(-1)?.enabled).toBe(true);
  });

  it("composites the provider's tiles", async () => {
    const { provider, page } = createFakeMeetingProvider();
    const { session, flush, join, remote, tileFinders } = setup({
      provider,
      probe: { codec: 'vp9' },
    });
    session.start();
    remote(await join());
    await flush();
    expect(tileFinders).toHaveLength(1);
    expect(tileFinders[0]?.()).toBe(page.tiles);
  });

  it('ignores a malformed command from the bridge', async () => {
    const { session, fakeWin, flush, join, remote } = setup();
    session.start();
    remote(await join());
    await flush();
    const request = { ns: getAddOnId(), kind: 'req', id: 'other:1' };
    fakeWin.deliver({ ...request, type: 'bridge:command', data: { command: 'explode' } }, fakeWin);
    await flush();
    expect(session.getSnapshot().state).toBe('recording');
  });
});

describe('createPageSession microphone', () => {
  it('forgets a microphone the page stopped, which fires no event (a permission probe)', async () => {
    // Teams opens the microphone once on its pre-join screen and stops the track at once.
    const { session, sent, snapshots, micTrack, acquireMic, flush } = setup();
    session.start();
    await acquireMic();
    expect(session.getSnapshot().micLabel).toBe('USB mic');
    micTrack.stop();
    await vi.advanceTimersByTimeAsync(250);
    expect(session.getSnapshot().micLabel).toBeNull();
    expect(snapshots.at(-1)?.micLabel).toBeNull();
    // A recording started by hand on that screen mirrors nothing ...
    session.command('start');
    await flush();
    expect(sent.find((m) => m.type === 'started')?.data).toMatchObject({ micLabel: null });
    expect(micTrack.clones).toHaveLength(0);
    // ... until the page opens the microphone again on join.
    const joined = await acquireMic(createFakeMediaStreamTrack({ label: 'Headset' }));
    expect(joined.clones).toHaveLength(1);
    expect(session.getSnapshot().micLabel).toBe('Headset');
  });

  it('names no microphone in a recording started right after the page stopped it', async () => {
    const { session, sent, micTrack, acquireMic, flush } = setup();
    session.start();
    await acquireMic();
    micTrack.stop();
    session.command('start');
    await flush();
    expect(sent.find((m) => m.type === 'started')?.data).toMatchObject({ micLabel: null });
    expect(micTrack.clones).toHaveLength(0);
  });

  it('goes back to the microphone still open when the page stops a newer one (a microphone test)', async () => {
    // Zoom's "Test speaker and microphone" opens a second track next to the meeting's and stops it
    // when the dialog closes.
    const { session, snapshots, acquireMic, flush, join, remote } = setup();
    session.start();
    remote(await join());
    const meeting = await acquireMic(createFakeMediaStreamTrack({ label: 'meeting' }));
    const test = await acquireMic(createFakeMediaStreamTrack({ label: 'test' }));
    await flush();
    expect(session.getSnapshot()).toMatchObject({ state: 'recording', micLabel: 'test' });
    expect(meeting.clones[0]?.readyState).toBe('ended');
    expect(test.clones[0]?.enabled).toBe(true);
    test.stop();
    await vi.advanceTimersByTimeAsync(250);
    expect(test.clones[0]?.readyState).toBe('ended');
    expect(meeting.clones).toHaveLength(2);
    expect(meeting.clones[1]).toMatchObject({ readyState: 'live', enabled: true });
    expect(session.getSnapshot().micLabel).toBe('meeting');
    expect(snapshots.at(-1)?.micLabel).toBe('meeting');
  });

  it('goes back to the microphone still open when a newer one ends with an event', async () => {
    const { session, acquireMic, flush, join, remote } = setup();
    session.start();
    remote(await join());
    const meeting = await acquireMic(createFakeMediaStreamTrack({ label: 'meeting' }));
    const headset = await acquireMic(createFakeMediaStreamTrack({ label: 'Headset' }));
    headset.end();
    await flush();
    expect(meeting.clones.at(-1)).toMatchObject({ readyState: 'live', enabled: true });
    expect(session.getSnapshot().micLabel).toBe('meeting');
  });

  it('stops mirroring once every microphone of the page is stopped', async () => {
    const { session, snapshots, acquireMic, join, remote } = setup();
    session.start();
    remote(await join());
    const meeting = await acquireMic(createFakeMediaStreamTrack({ label: 'meeting' }));
    meeting.stop();
    await vi.advanceTimersByTimeAsync(250);
    expect(meeting.clones[0]?.readyState).toBe('ended');
    expect(snapshots.at(-1)).toMatchObject({ state: 'recording', micLabel: null });
  });
});

describe('createPageSession audio warm-up', () => {
  it('keeps an audio context running on a meeting page before anything records', async () => {
    // A page's first audio stream takes up to two seconds to open the audio device: a mixer that
    // started it only when the recording began lost what was said meanwhile.
    const { session, warmContexts, flush, join, remote } = setup();
    session.start();
    expect(warmContexts).toHaveLength(1);
    remote(await join());
    await flush();
    expect(session.getSnapshot().state).toBe('recording');
    expect(warmContexts).toHaveLength(1);
    expect(warmContexts[0]?.state).toBe('suspended');
  });

  it('starts no audio in a page that is not a meeting, and warms up once it becomes one', async () => {
    const { win, session, warmContexts, flush } = setup({ pathname: '/landing' });
    session.start();
    await vi.advanceTimersByTimeAsync(3_000);
    expect(warmContexts).toHaveLength(0);
    win.location.pathname = '/abc-defg-hij';
    win.history.pushState({}, '', '/abc-defg-hij');
    await flush();
    expect(warmContexts).toHaveLength(1);
  });

  it('closes the context when the page leaves the meeting, and on dispose', async () => {
    const { win, session, warmContexts, flush } = setup();
    session.start();
    win.location.pathname = '/landing';
    win.history.pushState({}, '', '/landing');
    await flush();
    expect(warmContexts[0]?.state).toBe('closed');
    win.location.pathname = '/xyz-abcd-efg';
    win.history.pushState({}, '', '/xyz-abcd-efg');
    await flush();
    expect(warmContexts).toHaveLength(2);
    session.dispose();
    expect(warmContexts[1]?.state).toBe('closed');
  });

  it('waits until the browser lets the page play audio: the microphone in use, or a click', async () => {
    // Before that, Firefox keeps a new context suspended and warns in the page's console.
    const { session, warmContexts, autoplay, acquireMic, logs } = setup({
      autoplay: 'disallowed',
    });
    session.start();
    await vi.advanceTimersByTimeAsync(3_000);
    expect(warmContexts).toHaveLength(0);
    expect(logs).toContainEqual(
      'info: audio warm-up: waiting until the page may play audio (a click, or the microphone in use)',
    );
    // A page that captures the microphone may play audio: the hook sees it at once.
    autoplay.policy = 'allowed';
    await acquireMic();
    expect(warmContexts).toHaveLength(1);
  });

  it('notices a click that lets the page play audio within a tick', async () => {
    const { session, warmContexts, autoplay } = setup({ autoplay: 'disallowed' });
    session.start();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(warmContexts).toHaveLength(0);
    autoplay.policy = 'allowed';
    await vi.advanceTimersByTimeAsync(1_000);
    expect(warmContexts).toHaveLength(1);
  });
});

describe('createPageSession while the extension takes no chunks', () => {
  const MiB = 2 ** 20;
  const startedInfo = z.object({ hasVideo: z.boolean().optional() });
  /** Whether each recording that started had video. */
  const startedKinds = (sent: { type: string; data: unknown }[]) =>
    sent
      .filter((m) => m.type === 'started')
      .map((m) => startedInfo.parse(m.data).hasVideo ?? false);
  const endings = (sent: { type: string; data: unknown }[]) =>
    sent.filter((m) => m.type === 'ended').map((m) => m.data);
  /** The extension takes chunks again; returns the seqs it got of a recording. */
  const takeChunksAgain = async ({ bridge, sent }: ReturnType<typeof setup>) => {
    bridge.onMessage('page:chunk', ({ data }) => {
      sent.push({ type: 'chunk', data });
      return { ok: true } as const;
    });
    await vi.advanceTimersByTimeAsync(20_000);
    const chunks = sent.filter((m) => m.type === 'chunk').map((m) => sentChunk.parse(m.data));
    return (id: string | null) => chunks.filter((c) => c.recordingId === id).map((c) => c.seq);
  };

  it("starts the next recording at once after an audio encoder failure, counts the failed one's chunks toward the audio limit, and once they fill it records nothing until the extension took them all", async () => {
    const page = setup({ backlogLimitBytes: 2 * MiB });
    const { session, sent, logs, flush, join, remote, instance, offChunk } = page;
    session.start();
    remote(await join());
    await flush();
    const first = session.getSnapshot().recordingId;
    // A full disk, a store that hangs, the add-on disabled.
    offChunk();
    instance().emitData(1.5 * MiB);
    instance().emitError(new Error('disk full'));
    await flush();
    const second = session.getSnapshot().recordingId;
    // The page still claims the failed recording: its chunks wait in the page.
    expect(session.getSnapshot().pendingRecordingIds).toEqual([first]);
    expect(startedKinds(sent)).toEqual([false, false]);
    instance().emitData(0.25 * MiB);
    await vi.advanceTimersByTimeAsync(1000);
    expect(session.debug().stoppedBacklog.audioOnly).toBe(1.5 * MiB);
    instance().emitData(0.5 * MiB);
    await flush();
    expect(logs).toContain(
      `warn: backlog full: 768 KiB of recording ${second} (its last 1 s) and 1.5 MiB of earlier recordings wait for the extension, more than the 2.0 MiB the page holds. The recording stops here; the next one starts once the extension has taken them`,
    );
    // Nothing records while the page holds its whole limit, however long that lasts.
    await vi.advanceTimersByTimeAsync(120_000);
    // The bridge hears it: no "Saving…", the page waits for the extension to take them.
    expect(page.snapshots.at(-1)).toMatchObject({
      state: 'stopping',
      recordingId: null,
      pendingRecordingIds: [first, second],
      backlogFull: 'waiting',
    });
    expect(session.debug().stoppedBacklog.audioOnly).toBe(2.25 * MiB);
    expect(startedKinds(sent)).toHaveLength(2);
    // Every chunk arrives, in order, then each end; then the next recording starts.
    const seqs = await takeChunksAgain(page);
    expect([seqs(first), seqs(second)]).toEqual([[0], [0, 1]]);
    expect(endings(sent)).toEqual([
      expect.objectContaining({ recordingId: first, reason: 'encoder-error', chunkCount: 1 }),
      expect.objectContaining({ recordingId: second, reason: 'backlog-full', chunkCount: 2 }),
    ]);
    expect(startedKinds(sent)).toHaveLength(3);
    // Both ends acked: the background has every chunk, the page claims neither, nothing is full.
    expect(page.snapshots.at(-1)).toMatchObject({ state: 'recording', pendingRecordingIds: [] });
    expect(page.snapshots.at(-1)).not.toHaveProperty('backlogFull');
  });

  it("starts a recording with video at once when Record follows Stop, counts the stopped one's video toward the limit, and once they fill it records audio only at once, under a limit of its own, until the extension took the video", async () => {
    const page = setup({ probe: { codec: 'vp9' }, backlogLimitBytes: 2 * MiB });
    const { session, sent, logs, flush, join, remote, videoRecorders, instance, offChunk } = page;
    session.start();
    await flush();
    remote(await join());
    await flush();
    const first = session.getSnapshot().recordingId;
    offChunk();
    videoRecorders[0]?.emitData(1.5 * MiB);
    session.command('stop');
    await flush();
    session.command('start');
    await flush();
    const second = session.getSnapshot().recordingId;
    expect(startedKinds(sent)).toEqual([true, true]);
    videoRecorders[1]?.emitData(MiB);
    await flush();
    expect(logs).toContain(
      `warn: backlog full: 1.0 MiB of recording ${second} (its last 0 s) and 1.5 MiB of earlier recordings wait for the extension, more than the 2.0 MiB the page holds. The video stops here; the rest of the meeting records audio only`,
    );
    expect(videoRecorders[1]?.calls).toEqual(['start', 'stop']);
    expect(startedKinds(sent)).toEqual([true, true, false]);
    instance().emitData(100);
    await flush();
    expect(session.debug()).toMatchObject({
      backlog: { bytes: 100, chunks: 1 },
      stoppedBacklog: { withVideo: 2.5 * MiB, audioOnly: 0 },
    });
    expect(page.snapshots.at(-1)?.backlogFull).toBe('audio-only');
    const seqs = await takeChunksAgain(page);
    expect(page.snapshots.at(-1)).not.toHaveProperty('backlogFull');
    expect([seqs(first), seqs(second)]).toEqual([[0], [0]]);
    // Taken, and the audio-only recording keeps up: a tick brings the video back.
    await vi.advanceTimersByTimeAsync(1_000);
    await flush();
    expect(startedKinds(sent)).toEqual([true, true, false, true]);
    expect(logs).toContain('info: the extension took the backlog: recording with video again');
    expect(endings(sent)).toEqual([
      expect.objectContaining({ recordingId: first, reason: 'command', chunkCount: 1 }),
      expect.objectContaining({ recordingId: second, reason: 'backlog-full', chunkCount: 1 }),
      expect.objectContaining({ reason: 'video-back' }),
    ]);
    // No encoder failure was counted.
    expect(logs.filter((line) => line.includes('encoder error'))).toEqual([]);
  });
});

describe('createPageSession, the position in the file', () => {
  it("follows the mixer's audio clock without video, pauses left out, and ends with it", async () => {
    const { session, sent, flush, join, remote, audio, fromBridge } = setup();
    session.start();
    expect(session.debug().clock).toBeNull();
    remote(await join());
    await flush();
    audio.advanceGraph(2);
    await fromBridge('bridge:command', { command: 'pause' });
    audio.advanceGraph(3); // the wall clock moves too: neither counts while paused
    expect(session.debug().clock).toEqual({ mediaMs: 2000, paused: true });
    await fromBridge('bridge:command', { command: 'resume' });
    audio.advanceGraph(1.5);
    await fromBridge('bridge:command', { command: 'stop' });
    await flush();
    expect(sent.find((m) => m.type === 'ended')?.data).toMatchObject({ mediaDurationMs: 3500 });
  });
});
