/**
 * Page-side orchestrator (MAIN world), shared by every meeting provider. Wires the provider's
 * capture hooks, the mixer, the encoder (audio-only MediaRecorder, or the WebCodecs video pipeline
 * when a plan is available) and the lifecycle reducer together and talks to the bridge content
 * script. Everything service-specific comes from `deps.provider`.
 */
import { canEncodeAudio, canEncodeVideo } from 'mediabunny';
import { canStartAudioContext } from '@/lib/page/can-start-audio-context';
import { createAudioWarmup, type WarmContext } from '@/lib/page/create-audio-warmup';
import {
  type ChunkBacklog,
  createChunkSender,
  MAX_PENDING_BYTES,
} from '@/lib/page/create-chunk-sender';
import {
  createMediaRecorderEncoder,
  type EncodedChunk,
  type Encoder,
} from '@/lib/page/create-media-recorder-encoder';
import { createMicMirror, type MicMirror } from '@/lib/page/create-mic-mirror';
import { createMicWatcher } from '@/lib/page/create-mic-watcher';
import { createMixer, MIXER_CONTEXT_OPTIONS, type Mixer } from '@/lib/page/create-mixer';
import { createPageBacklog } from '@/lib/page/create-page-backlog';
import { createVideoRecorder, type VideoRecorder } from '@/lib/page/create-video-recorder';
import type { WindowMessenger } from '@/lib/page/create-window-messenger';
import { formatBacklogFull } from '@/lib/page/format-backlog-full';
import { installVisibilitySpoof } from '@/lib/page/install-visibility-spoof';
import { probeVideoEncoder } from '@/lib/page/probe-video-encoder';
import {
  type LifecycleEffect,
  type LifecycleEvent,
  type LifecycleInputs,
  type LifecycleState,
  reduceLifecycle,
} from '@/lib/page/reduce-lifecycle';
import { watchNavigation } from '@/lib/page/watch-navigation';
import { parseBridgeCommand } from '@/lib/protocol/parse-bridge-command';
import { parsePageConfig } from '@/lib/protocol/parse-page-config';
import type {
  MediaCapture,
  MeetingLocation,
  MeetingProvider,
  MeetingState,
} from '@/lib/providers/types';
import type {
  LifecycleCommand,
  PageConfig,
  PageProtocolMap,
  RecordingStartedInfo,
  StopReason,
  TabSnapshot,
  VideoTile,
} from '@/lib/types';
import type { FrameStatsSnapshot } from '@/lib/video/create-frame-stats';
import { decideVideoRate, RATE_WINDOW_MS } from '@/lib/video/decide-video-rate';
import { formatVideoPerf } from '@/lib/video/format-video-perf';
import { pickVideoPlan, type VideoPlan, type VideoProbe } from '@/lib/video/pick-video-plan';

const DEAD_CONNECTION_GRACE_MS = 5_000;
/** A broken encoder fails within seconds: after this many restarts in a row the session gives up. */
const MAX_ENCODER_RESTARTS = 3;
/** A failure later than this after the previous one is the first of a new run. */
const ENCODER_FAILURE_WINDOW_MS = 60_000;
const TICK_MS = 1_000;
/** The adaptive frame rate never goes below this (see `decideVideoRate`). */
const MIN_VIDEO_FPS = 5;
/** First wait before the adaptive rate may go back up; doubles after every step down. */
const UPGRADE_HOLD_MS = 20_000;
/** How long a start may wait for the initial video probe before going audio-only. */
const PROBE_WAIT_MS = 2_000;
/** The first "video perf" diagnostics line comes this long into a recording, then every interval. */
const PERF_FIRST_MS = 60_000;
const PERF_EVERY_MS = 600_000;

export interface PageDebugInfo {
  connections: number;
  remoteAudioTracks: { id: string; muted: boolean; enabled: boolean; readyState: string }[];
  admitted: boolean;
  /** The video pipeline's statistics while a recording with video runs. */
  video: (FrameStatsSnapshot & { fps: number }) | null;
  /** The chunks of the running recording that the bridge has not acked yet. */
  backlog: { bytes: number; chunks: number } | null;
  /** The bytes not acked yet of the page's stopped recordings, by kind. */
  stoppedBacklog: { withVideo: number; audioOnly: number };
}

export interface PageSession {
  start(): void;
  configure(config: PageConfig): void;
  command(command: LifecycleCommand): void;
  getSnapshot(): TabSnapshot;
  /** Low-level state; a test build exposes it to the page as `__zenRecorderPage.debug()`. */
  debug(): PageDebugInfo;
  dispose(): void;
}

interface EncoderCallbacks {
  onChunk: (chunk: EncodedChunk) => void;
  onError: (error: Error) => void;
}

export interface PageSessionDeps {
  win: Window & typeof globalThis;
  messenger: WindowMessenger<PageProtocolMap>;
  /** The meeting service this page belongs to. */
  provider: MeetingProvider;
  /** The page's location as the provider should see it (normalized for the local fixture). */
  readLocation: () => MeetingLocation;
  createEncoder?: (callbacks: EncoderCallbacks) => Encoder;
  createMixer?: () => Mixer;
  /** The context that keeps the page's audio graph running for the mixer (`createAudioWarmup`). */
  createWarmContext?: () => WarmContext;
  createVideoRecorder?: (
    input: EncoderCallbacks & {
      plan: VideoPlan;
      context: AudioContext;
      findTiles: () => VideoTile[];
      onLog?: (message: string) => void;
    },
  ) => VideoRecorder;
  probeVideo?: (input: {
    width: number;
    height: number;
    bitsPerSecond: number;
  }) => Promise<VideoProbe | null>;
  /**
   * How many bytes of unacked chunks a recording may hold, read when it starts. Default
   * `MAX_PENDING_BYTES`; test builds lower it so a run fills it in seconds.
   */
  backlogLimitBytes?: () => number;
}

interface ActiveRecording {
  id: string;
  /** Sent on start and again whenever a (possibly new) bridge configures the page. */
  startedInfo: RecordingStartedInfo | null;
  startedAt: number;
  startedPerf: number;
  /** When (performance clock) the next "video perf" line is due. */
  perfLogAt: number;
  /** The frame rate the settings asked for (0 without video). */
  nominalFps: number;
  /** Adaptive frame rate state: when the rate last changed and how long to hold before going up. */
  rate: { changedAt: number; upgradeHoldMs: number };
  mixer: Mixer;
  encoder: Encoder;
  video: VideoRecorder | null;
  uninstallSpoof: (() => void) | null;
  sender: ReturnType<typeof createChunkSender>;
  chunkCount: number;
  micMirror: MicMirror | null;
}

export function createPageSession(deps: PageSessionDeps): PageSession {
  const { win, messenger, provider } = deps;
  const createEncoder =
    deps.createEncoder ??
    ((callbacks) =>
      createMediaRecorderEncoder({
        MediaRecorder: win.MediaRecorder,
        now: () => win.performance.now(),
        ...callbacks,
      }));
  const makeMixer = deps.createMixer ?? (() => createMixer(win.document));
  const makeWarmContext =
    deps.createWarmContext ?? (() => new win.AudioContext(MIXER_CONTEXT_OPTIONS));
  const makeVideoRecorder =
    deps.createVideoRecorder ?? ((input) => createVideoRecorder({ win, ...input }));
  const probeVideo =
    deps.probeVideo ??
    ((input) => {
      // Absent under resistFingerprinting or on insecure pages; the probe then resolves to null.
      return probeVideoEncoder({
        hasWebCodecs:
          typeof win.VideoEncoder !== 'undefined' && typeof win.AudioEncoder !== 'undefined',
        canEncodeVideo: (codec, options) => canEncodeVideo(codec, options),
        canEncodeAudio: (codec, options) => canEncodeAudio(codec, options),
        ...input,
      });
    });
  /** The page's limit for chunks the extension has not taken, and its stopped recordings' ones. */
  const pageBacklog = createPageBacklog(deps.backlogLimitBytes ?? (() => MAX_PENDING_BYTES));

  const readMeeting = (): MeetingState =>
    provider.readMeeting({ location: deps.readLocation(), document: win.document });
  const readMicMuted = provider.readMicMuted;

  let config: PageConfig = parsePageConfig(undefined);
  /** What the provider last read from the page; refreshed on navigation, media events and ticks. */
  let meeting: MeetingState = readMeeting();
  let lifecycle: LifecycleState | undefined;
  /** The inputs last handed to the reducer (serialized), to tell a real change from a re-read. */
  let dispatchedInputs = '';
  let active: ActiveRecording | null = null;
  let lastSnapshotJson = '';
  let tickTimer = 0;
  /** undefined = the first probe has not answered yet. */
  let videoProbe: VideoProbe | null | undefined;
  let probePending: Promise<void> | null = null;
  let probeRequest = 0;
  let startGeneration = 0;
  /**
   * A start the lifecycle asked for while paused (a paused recording that failed, or Pause pressed
   * while the start waited for the probe): nothing is captured, and no file exists, until Resume.
   */
  let startOnResume = false;
  /** Set when the video pipeline failed in this meeting; the rest of it is recorded audio-only. */
  let videoDisabledForMeeting = false;
  const cleanups: (() => void)[] = [];

  const now = () => Date.now();
  const lifecycleConfig = () => ({
    autoRecord: config.autoRecord,
    startRule: config.startRule,
    deadConnectionGraceMs: DEAD_CONNECTION_GRACE_MS,
    maxEncoderRestarts: MAX_ENCODER_RESTARTS,
    encoderFailureWindowMs: ENCODER_FAILURE_WINDOW_MS,
  });

  const log = (level: 'info' | 'warn' | 'error', message: string): void => {
    messenger.notify('page:log', { level, message });
  };

  const buildSnapshot = (): TabSnapshot => ({
    state: lifecycle?.status ?? 'idle',
    provider: provider.id,
    meetingCode: meeting.meetingId,
    title: meeting.title,
    recordingId: active?.id ?? null,
    recordingStartedAt: active?.startedAt ?? null,
    remoteTracks: capture.remoteAudioTracks().length,
    micLabel: mics.current()?.label ?? null,
    connected: capture.anyConnected(),
    admitted: lifecycle?.inputs.admitted ?? false,
    ...(active?.video ? { videoTiles: active.video.tileCount() } : {}),
    ...pageBacklog.snapshot(),
  });

  /** The snapshot as of now: re-reads the page, so a title that just appeared is in it. */
  const getSnapshot = (): TabSnapshot => {
    meeting = readMeeting();
    return buildSnapshot();
  };

  const publishSnapshot = (force = false): void => {
    const snapshot = buildSnapshot();
    const json = JSON.stringify(snapshot);
    if (!force && json === lastSnapshotJson) return;
    lastSnapshotJson = json;
    messenger.notify('page:snapshot', snapshot);
  };

  /** Asks WebCodecs (once per size) whether video can be encoded; result used at the next start. */
  const refreshProbe = (): void => {
    const wanted = pickVideoPlan({ config, probe: { codec: 'vp9' } });
    if (!wanted) return;
    const request = ++probeRequest;
    const probeStarted = win.performance.now();
    probePending = probeVideo({
      width: wanted.width,
      height: wanted.height,
      bitsPerSecond: wanted.bitsPerSecond,
    })
      .catch((error: unknown) => {
        log('warn', `video probe failed: ${String(error)}`);
        return null;
      })
      .then((probe) => {
        if (request !== probeRequest) return;
        videoProbe = probe;
        const took = Math.round(win.performance.now() - probeStarted);
        log(
          'info',
          probe
            ? `video probe: ${probe.codec} (${took} ms)`
            : 'video probe: no encoder, audio only',
        );
      });
  };

  const attachMic = (recording: ActiveRecording, track: MediaStreamTrack): void => {
    recording.micMirror?.dispose();
    const mirror = createMicMirror(track, {
      setInterval: (handler, ms) => win.setInterval(handler, ms),
      clearInterval: (id) => win.clearInterval(id),
      // A mirror is always disposed before it is replaced, so this can only refer to itself.
      onEnded: () => {
        recording.micMirror = null;
      },
      // Providers whose mute is not visible on the track read it from the page's own UI.
      ...(readMicMuted ? { isMuted: () => readMicMuted(win.document) } : {}),
    });
    recording.micMirror = mirror;
    recording.mixer.addTrack(mirror.clone);
  };

  const startRecording = (): void => {
    if (lifecycle?.status === 'paused') {
      startOnResume = true;
      log('info', 'paused: the next recording starts on Resume');
      return;
    }
    // The first probe (a real test encode) may still be running when a call connects right after
    // page load: wait for it briefly rather than committing to audio-only for the whole meeting.
    const wantsVideo = config.videoMode !== 'off' && !videoDisabledForMeeting;
    if (wantsVideo && videoProbe === undefined && probePending) {
      const generation = ++startGeneration;
      const timeout = new Promise<void>((resolve) => win.setTimeout(resolve, PROBE_WAIT_MS));
      void Promise.race([probePending, timeout]).then(() => {
        // A stop while waiting moved the generation on; a Pause meanwhile defers to Resume.
        if (generation !== startGeneration || active) return;
        videoProbe ??= null;
        startRecording();
      });
      return;
    }
    startNow();
  };

  const startNow = (): void => {
    // The page may have stopped its microphone since the last poll: name and mirror the one open now.
    mics.check();
    const id = win.crypto.randomUUID();
    const mixer = makeMixer();
    const plan = videoDisabledForMeeting
      ? null
      : pickVideoPlan({ config, probe: videoProbe ?? null });
    const callbacks: EncoderCallbacks = {
      onChunk: (chunk) => {
        recording.chunkCount++;
        recording.sender.enqueue({ recordingId: id, ...chunk });
      },
      onError: (error) => {
        // A pipeline that was already stopped or replaced must not end the recording after it.
        if (active !== recording) return;
        if (recording.video) {
          log('error', `video encoder error: ${error.message}; continuing audio-only`);
          videoDisabledForMeeting = true;
        } else {
          log('error', `encoder error: ${error.message}`);
        }
        // Not a Stop: the lifecycle restarts the recording, a bounded number of times.
        dispatch({ type: 'recorderFailed', now: now() });
      },
    };
    let video: VideoRecorder | null = null;
    if (plan) {
      try {
        video = makeVideoRecorder({
          plan,
          context: mixer.context,
          findTiles: () => provider.findTiles(win.document),
          onLog: (message) => log('info', message),
          ...callbacks,
        });
      } catch (error) {
        log('error', `video pipeline unavailable: ${String(error)}; recording audio-only`);
        videoDisabledForMeeting = true;
      }
    }
    const recording: ActiveRecording = {
      id,
      startedInfo: null,
      startedAt: now(),
      startedPerf: win.performance.now(),
      perfLogAt: win.performance.now() + PERF_FIRST_MS,
      nominalFps: plan?.fps ?? 0,
      rate: { changedAt: win.performance.now(), upgradeHoldMs: UPGRADE_HOLD_MS },
      mixer,
      encoder: video ? video.encoder : createEncoder(callbacks),
      video,
      uninstallSpoof: null,
      sender: createChunkSender({
        send: (chunk) => messenger.sendMessage('page:chunk', chunk),
        sendEnd: (info) => messenger.sendMessage('page:recordingEnded', info),
        maxPendingBytes: pageBacklog.limitBytes(),
        // The page's limit is for all its recordings of a kind: the stopped ones' chunks count.
        pendingElsewhere: () => pageBacklog.stoppedBytes(video !== null),
        onFull: (backlog) => onBacklogFull(recording, backlog),
      }),
      chunkCount: 0,
      micMirror: null,
    };
    active = recording;
    for (const track of capture.remoteAudioTracks()) mixer.addTrack(track);
    const mic = mics.current();
    if (mic) attachMic(recording, mic);
    mixer.context.addEventListener('statechange', () => mixer.resume());

    try {
      recording.encoder.start(mixer.stream, {
        audioBitsPerSecond: config.audioBitsPerSecond,
        timesliceMs: config.timesliceMs,
      });
    } catch (error) {
      log('error', `failed to start recorder: ${String(error)}`);
      active = null;
      video?.dispose();
      void mixer.close();
      if (video) {
        // The video pipeline is the likely culprit: record the rest of the meeting audio-only.
        videoDisabledForMeeting = true;
        startNow();
        return;
      }
      dispatch({ type: 'recorderFailed', now: now() });
      return;
    }
    if (video && config.spoofVisibility) recording.uninstallSpoof = installVisibilitySpoof(win);

    const snapshot = getSnapshot();
    recording.startedInfo = {
      recordingId: id,
      provider: provider.id,
      meetingCode: snapshot.meetingCode ?? 'unknown',
      title: snapshot.title,
      startedAt: recording.startedAt,
      mimeType: recording.encoder.mimeType(),
      micLabel: mic?.label ?? null,
      ...(video ? { hasVideo: true } : {}),
    };
    messenger.notify('page:recordingStarted', recording.startedInfo);
    const detail = plan ? `, video ${plan.width}x${plan.height}@${plan.fps}` : '';
    log('info', `recording started (${recording.encoder.mimeType()}${detail})`);
    publishSnapshot(true);
  };

  const stopRecording = async (reason: StopReason): Promise<void> => {
    startGeneration++; // cancels a start still waiting for the probe
    startOnResume = false;
    const recording = active;
    if (!recording) {
      dispatch({ type: 'recorderStopped', now: now() });
      return;
    }
    active = null;
    // Claimed from here on, while the encoder hands over its last chunks too.
    pageBacklog.add(recording.id, recording.sender, recording.video !== null, reason);
    if (reason === 'pagehide') recording.encoder.flush();
    logVideoPerf(recording);
    await recording.encoder.stop();
    recording.video?.dispose();
    recording.uninstallSpoof?.();
    recording.micMirror?.dispose();
    await recording.mixer.close();
    // Sent behind the last chunk, again until the background has it.
    recording.sender.end({
      recordingId: recording.id,
      chunkCount: recording.chunkCount,
      durationMs: Math.round(win.performance.now() - recording.startedPerf),
      reason,
    });
    log('info', `recording ended (${reason}) after ${recording.chunkCount} chunks`);
    // The next recording starts at once, beside this one's chunks, so a meeting is recorded even
    // while the extension takes none; they count toward its limit. It waits only when the page
    // already holds more than the limit for its kind (with video, or audio only once the video
    // failed or filled up), until the extension has taken every chunk of that kind.
    await pageBacklog.whenRoom(recording.video !== null && !videoDisabledForMeeting);
    // After an encoder failure the lifecycle starts the next recording right here.
    dispatch({ type: 'recorderStopped', now: now() });
    publishSnapshot(true);
  };

  /**
   * The extension took none of the recording's chunks until they filled the page's limit, with
   * what its stopped recordings of the same kind still hold: a full disk, a store that keeps
   * failing, an extension disabled mid-meeting. Every chunk stays until it takes them, and the
   * recording stops so the page holds no more. With video the rest of the meeting records audio
   * only, about 40 times smaller; audio alone starts again once the extension has taken the
   * page's audio backlog.
   */
  const onBacklogFull = (recording: ActiveRecording, backlog: ChunkBacklog): void => {
    // The chunks a recording hands over while it stops may still fill it.
    if (active !== recording) return;
    const hasVideo = recording.video !== null;
    log('warn', formatBacklogFull({ recordingId: recording.id, hasVideo, backlog }));
    if (hasVideo) videoDisabledForMeeting = true;
    dispatch({ type: 'backlogFull', now: now() });
  };

  const apply = (effects: LifecycleEffect[]): void => {
    for (const effect of effects) {
      switch (effect.type) {
        case 'startRecording':
          startRecording();
          break;
        case 'pauseRecording':
          active?.encoder.pause();
          break;
        case 'resumeRecording':
          if (startOnResume) {
            startOnResume = false;
            startRecording();
          } else {
            active?.encoder.resume();
          }
          break;
        case 'stopRecording':
          void stopRecording(effect.reason);
          break;
        case 'restartsExhausted':
          log(
            'warn',
            `encoder failed ${effect.failures} times in a row: not restarting until Record is pressed or another meeting starts`,
          );
          break;
      }
    }
  };

  const dispatch = (event: LifecycleEvent): void => {
    const result = reduceLifecycle(lifecycle, event, lifecycleConfig());
    lifecycle = result.state;
    apply(result.effects);
  };

  /** The reducer's view of the page: what the provider reads plus what the capture reports. */
  const readInputs = (): LifecycleInputs => ({
    isMeeting: meeting.meetingId !== null,
    anyConnected: capture.anyConnected(),
    // A provider that can count participants decides when "someone else is here"; otherwise the
    // presence of remote audio does.
    remoteAudioTracks: meeting.remoteParticipants ?? capture.remoteAudioTracks().length,
    admitted: meeting.admitted,
  });

  const updateInputs = (): void => {
    meeting = readMeeting();
    if (meeting.meetingId === null) videoDisabledForMeeting = false;
    keepAudioWarm();
    const inputs = readInputs();
    dispatchedInputs = JSON.stringify(inputs);
    dispatch({ type: 'inputs', inputs, now: now() });
    publishSnapshot();
  };

  /**
   * What the page shows (meeting id, admission, participants) has no event of its own, so it is
   * re-read on a timer. New inputs are dispatched only when one of them changed: a per-tick inputs
   * refresh collapsed the encoder timeline in headless hidden tabs.
   */
  const pollMeeting = (): void => {
    meeting = readMeeting();
    if (JSON.stringify(readInputs()) !== dispatchedInputs) updateInputs();
    else dispatch({ type: 'tick', now: now() });
  };

  const command = (cmd: LifecycleCommand): void => {
    dispatch({ type: 'command', command: cmd, now: now() });
    publishSnapshot(true);
  };

  /** Writes a "video perf" line for the recording to the diagnostics log. */
  function logVideoPerf(recording: ActiveRecording): void {
    const { video } = recording;
    if (!video) return;
    const elapsedS = (win.performance.now() - recording.startedPerf) / 1000;
    log(
      'info',
      formatVideoPerf({
        stats: video.stats(),
        fps: video.fps(),
        nominalFps: recording.nominalFps,
        elapsedS,
      }),
    );
  }

  const reportVideoPerf = (): void => {
    const recording = active;
    if (!recording?.video || win.performance.now() < recording.perfLogAt) return;
    recording.perfLogAt = win.performance.now() + PERF_EVERY_MS;
    logVideoPerf(recording);
  };

  /**
   * Adapts the composite frame rate to what the page's main thread and the encoder can sustain,
   * down when overloaded and back up when the load allows (`decideVideoRate`).
   */
  const adaptVideoRate = (): void => {
    const recording = active;
    const video = recording?.video;
    if (!recording || !video || recording.encoder.state() !== 'recording') return;
    const now = win.performance.now();
    const fps = video.fps();
    const decision = decideVideoRate({
      fps,
      nominalFps: recording.nominalFps,
      minFps: MIN_VIDEO_FPS,
      load: video.recentLoad(RATE_WINDOW_MS),
      sinceChangeMs: now - recording.rate.changedAt,
      upgradeHoldMs: recording.rate.upgradeHoldMs,
    });
    recording.rate.upgradeHoldMs = decision.upgradeHoldMs;
    const { next } = decision;
    if (!next) return;
    video.setFps(next.fps);
    recording.rate.changedAt = now;
    const lowered = next.fps < fps;
    log(
      lowered ? 'warn' : 'info',
      `video rate ${lowered ? 'lowered' : 'raised'} to ${next.fps} fps: ${next.reason}`,
    );
  };

  /**
   * A meeting page keeps the mixer's audio graph running, so a recording's audio starts with the
   * recording rather than once the browser has opened the audio device. Held again on every
   * tick and when the page opens a microphone, the moments the browser may start allowing it.
   */
  const warmup = createAudioWarmup({
    createContext: makeWarmContext,
    canStart: () => canStartAudioContext(win.navigator),
    now: () => win.performance.now(),
    onLog: log,
  });
  const keepAudioWarm = (): void => warmup.hold(meeting.meetingId !== null);

  /** The microphone the page uses changed (opened, stopped, an older one again): follow it. */
  const mics = createMicWatcher({
    setInterval: (handler, ms) => win.setInterval(handler, ms),
    clearInterval: (id) => win.clearInterval(id),
    onChange: (track) => {
      if (active) {
        if (track) attachMic(active, track);
        else active.micMirror?.dispose();
      }
      publishSnapshot(true);
    },
  });

  // Hooks go in immediately: this runs at document_start, before the page's own scripts.
  const capture: MediaCapture = provider.installCapture(win, {
    remoteAudioTrackAdded: (track) => {
      active?.mixer.addTrack(track);
      updateInputs();
    },
    remoteAudioTrackEnded: () => updateInputs(),
    connectionsChanged: () => updateInputs(),
    micTrackAdded: (track) => {
      mics.add(track);
      // A page that captures the microphone may play audio.
      keepAudioWarm();
    },
  });

  function configure(next: PageConfig): void {
    config = next;
    refreshProbe();
    dispatch({ type: 'tick', now: now() });
    // A configure may come from a bridge that was (re)loaded mid-recording: make sure its
    // background knows about the active recording before the next chunk arrives.
    if (active?.startedInfo) messenger.notify('page:recordingStarted', active.startedInfo);
    publishSnapshot(true);
  }

  return {
    start() {
      cleanups.push(
        () => capture.uninstall(),
        messenger.onMessage('bridge:configure', ({ data }) => configure(parsePageConfig(data))),
        messenger.onMessage('bridge:command', ({ data }) => {
          const parsed = parseBridgeCommand(data);
          if (parsed) command(parsed);
        }),
        watchNavigation(win, updateInputs),
      );
      const onPageHide = () => dispatch({ type: 'pagehide', now: now() });
      win.addEventListener('pagehide', onPageHide);
      cleanups.push(() => win.removeEventListener('pagehide', onPageHide));
      tickTimer = win.setInterval(() => {
        pollMeeting();
        keepAudioWarm();
        adaptVideoRate();
        reportVideoPerf();
        publishSnapshot();
      }, TICK_MS);
      refreshProbe();
      updateInputs();
      messenger.notify('page:ready', undefined);
    },
    configure,
    command,
    getSnapshot,
    debug: () => ({
      connections: capture.connectionCount(),
      remoteAudioTracks: capture.remoteAudioTracks().map((t) => ({
        id: t.id,
        muted: t.muted,
        enabled: t.enabled,
        readyState: t.readyState,
      })),
      admitted: readMeeting().admitted,
      video: active?.video ? { fps: active.video.fps(), ...active.video.stats() } : null,
      backlog: active
        ? { bytes: active.sender.pendingBytes(), chunks: active.sender.pending() }
        : null,
      stoppedBacklog: {
        withVideo: pageBacklog.stoppedBytes(true),
        audioOnly: pageBacklog.stoppedBytes(false),
      },
    }),
    dispose() {
      win.clearInterval(tickTimer);
      mics.dispose();
      warmup.hold(false);
      for (const cleanup of cleanups.splice(0)) cleanup();
    },
  };
}
