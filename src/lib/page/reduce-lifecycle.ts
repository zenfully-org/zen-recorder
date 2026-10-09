/**
 * Pure recording lifecycle reducer. Runs in the Meet page but has no DOM or browser dependencies.
 * WebRTC signals are the primary input; URL/DOM hints only corroborate.
 */

import { hasGivenUpOnEncoder } from '@/lib/page/has-given-up-on-encoder';
import type { LifecycleCommand, RecordingState, StartRule, StopReason } from '@/lib/types';

export interface LifecycleConfig {
  autoRecord: boolean;
  startRule: StartRule;
  /** How long all connections may be dead before the recording is stopped. */
  deadConnectionGraceMs: number;
  /** How many encoder failures in a row are answered with a new recording before giving up. */
  maxEncoderRestarts: number;
  /** A failure later than this after the previous one starts a new count. */
  encoderFailureWindowMs: number;
}

export interface LifecycleInputs {
  isMeeting: boolean;
  anyConnected: boolean;
  remoteAudioTracks: number;
  /**
   * The page shows the in-call UI (DOM hint). Meet already opens peer connections and receives
   * remote tracks while the user is still knocking in the lobby, so auto-start also waits for this.
   */
  admitted: boolean;
}

export interface LifecycleState {
  status: RecordingState;
  inputs: LifecycleInputs;
  manuallyStopped: boolean;
  disconnectedSince: number | null;
  /**
   * Whether a connection existed at some point during the current recording. A recording started
   * by hand while alone must not be killed by the connection-loss rule before it ever connected.
   */
  connectedDuringRecording: boolean;
  /**
   * Encoder failures in a row: each less than `encoderFailureWindowMs` after the one before. Past
   * `maxEncoderRestarts` nothing restarts or auto-starts until Record is pressed or the meeting
   * route is left, so a broken encoder cannot loop or leave a trail of files.
   */
  encoderFailures: number;
  encoderFailedAt: number | null;
  /**
   * The recording being stopped failed: it starts again in this status once the recorder has
   * stopped. A paused recording comes back paused, so a restart never records what the user paused.
   * Pause, Resume and Stop pressed while the recorder stops change it.
   */
  restartAs: 'recording' | 'paused' | null;
}

export type LifecycleEvent =
  | { type: 'inputs'; inputs: Partial<LifecycleInputs>; now: number }
  | { type: 'command'; command: LifecycleCommand; now: number }
  | { type: 'pagehide'; now: number }
  /** The encoder broke: stop without marking a manual stop, then restart within the budget. */
  | { type: 'recorderFailed'; now: number }
  /**
   * Stop the recording and start the next one in its status, for the page's backlog: the extension
   * took none of its chunks until they filled the page's limit (`backlog-full`: the session decides
   * when the next one can start, at once with the video dropped, otherwise once the extension took
   * the backlog), or it took the backlog of the video recording that filled it (`video-back`: the
   * next one has video again). Not an encoder failure, so no restart is counted.
   */
  | { type: 'restart'; reason: 'backlog-full' | 'video-back'; now: number }
  | { type: 'recorderStopped'; now: number }
  | { type: 'tick'; now: number };

export type LifecycleEffect =
  /**
   * A recording is wanted. Emitted with status `paused` when a paused recording failed: the
   * session then starts nothing until `resumeRecording`, so no media is captured while paused.
   */
  | { type: 'startRecording' }
  | { type: 'pauseRecording' }
  | { type: 'resumeRecording' }
  | { type: 'stopRecording'; reason: StopReason }
  /** The encoder failed `failures` times in a row; the recording is not started again. */
  | { type: 'restartsExhausted'; failures: number };

export interface LifecycleResult {
  state: LifecycleState;
  effects: LifecycleEffect[];
}

const INITIAL: LifecycleState = {
  status: 'idle',
  inputs: { isMeeting: false, anyConnected: false, remoteAudioTracks: 0, admitted: false },
  manuallyStopped: false,
  disconnectedSince: null,
  connectedDuringRecording: false,
  encoderFailures: 0,
  encoderFailedAt: null,
  restartAs: null,
};

const NO_ENCODER_FAILURES = { encoderFailures: 0, encoderFailedAt: null } as const;

function graceExpired(state: LifecycleState, config: LifecycleConfig, now: number): boolean {
  return (
    state.disconnectedSince !== null &&
    now - state.disconnectedSince >= config.deadConnectionGraceMs
  );
}

function stop(state: LifecycleState, reason: StopReason): LifecycleResult {
  return { state: { ...state, status: 'stopping' }, effects: [{ type: 'stopRecording', reason }] };
}

function failRecorder(
  state: LifecycleState,
  status: 'recording' | 'paused',
  config: LifecycleConfig,
  now: number,
): LifecycleResult {
  const inARow =
    state.encoderFailedAt !== null && now - state.encoderFailedAt < config.encoderFailureWindowMs;
  const encoderFailures = inARow ? state.encoderFailures + 1 : 1;
  const failed = { ...state, encoderFailures, encoderFailedAt: now };
  if (!hasGivenUpOnEncoder(failed, config)) {
    return stop({ ...failed, restartAs: status }, 'encoder-error');
  }
  const { state: stopping, effects } = stop(failed, 'encoder-error');
  return {
    state: stopping,
    effects: [...effects, { type: 'restartsExhausted', failures: encoderFailures }],
  };
}

function recorderStopped(state: LifecycleState): LifecycleResult {
  const { isMeeting, anyConnected } = state.inputs;
  if (state.restartAs !== null && isMeeting) {
    return {
      state: {
        ...state,
        status: state.restartAs,
        restartAs: null,
        connectedDuringRecording: state.connectedDuringRecording || anyConnected,
      },
      effects: [{ type: 'startRecording' }],
    };
  }
  return {
    state: {
      ...state,
      status: isMeeting && anyConnected ? 'waiting' : 'idle',
      restartAs: null,
    },
    effects: [],
  };
}

/** Pause, Resume and Stop while a failed recorder stops apply to the recording that replaces it. */
function commandWhileRestarting(state: LifecycleState, command: LifecycleCommand): LifecycleResult {
  switch (command) {
    case 'pause':
      return { state: { ...state, restartAs: 'paused' }, effects: [] };
    case 'resume':
      return { state: { ...state, restartAs: 'recording' }, effects: [] };
    case 'stop':
      return { state: { ...state, restartAs: null, manuallyStopped: true }, effects: [] };
    case 'start':
      return { state, effects: [] };
  }
}

function evaluate(state: LifecycleState, config: LifecycleConfig, now: number): LifecycleResult {
  const { isMeeting, anyConnected, remoteAudioTracks, admitted } = state.inputs;
  switch (state.status) {
    case 'idle':
      return isMeeting && anyConnected
        ? evaluate({ ...state, status: 'waiting' }, config, now)
        : { state, effects: [] };
    case 'waiting': {
      if (!isMeeting) return { state: { ...state, status: 'idle' }, effects: [] };
      if (!anyConnected && graceExpired(state, config, now)) {
        return { state: { ...state, status: 'idle' }, effects: [] };
      }
      if (
        !config.autoRecord ||
        state.manuallyStopped ||
        hasGivenUpOnEncoder(state, config) ||
        !admitted
      ) {
        return { state, effects: [] };
      }
      const ready = config.startRule === 'onJoin' ? anyConnected : remoteAudioTracks > 0;
      return ready
        ? {
            state: { ...state, status: 'recording', connectedDuringRecording: anyConnected },
            effects: [{ type: 'startRecording' }],
          }
        : { state, effects: [] };
    }
    case 'recording':
    case 'paused': {
      if (!isMeeting) return stop(state, 'left-meeting');
      const seenConnection = state.connectedDuringRecording || anyConnected;
      if (seenConnection && !anyConnected && graceExpired(state, config, now)) {
        return stop(state, 'connections-lost');
      }
      return { state: { ...state, connectedDuringRecording: seenConnection }, effects: [] };
    }
    case 'stopping':
      return { state, effects: [] };
  }
}

function handleCommand(state: LifecycleState, command: LifecycleCommand): LifecycleResult {
  if (state.status === 'stopping' && state.restartAs !== null) {
    return commandWhileRestarting(state, command);
  }
  switch (command) {
    case 'start':
      return state.status === 'idle' || state.status === 'waiting'
        ? {
            state: {
              ...state,
              ...NO_ENCODER_FAILURES,
              status: 'recording',
              manuallyStopped: false,
              connectedDuringRecording: state.inputs.anyConnected,
            },
            effects: [{ type: 'startRecording' }],
          }
        : { state, effects: [] };
    case 'pause':
      return state.status === 'recording'
        ? { state: { ...state, status: 'paused' }, effects: [{ type: 'pauseRecording' }] }
        : { state, effects: [] };
    case 'resume':
      return state.status === 'paused'
        ? { state: { ...state, status: 'recording' }, effects: [{ type: 'resumeRecording' }] }
        : { state, effects: [] };
    case 'stop':
      return state.status === 'recording' || state.status === 'paused'
        ? stop({ ...state, manuallyStopped: true }, 'command')
        : { state, effects: [] };
  }
}

/** Applies one event; `state` undefined means "start from the initial state". */
export function reduceLifecycle(
  state: LifecycleState | undefined,
  event: LifecycleEvent,
  config: LifecycleConfig,
): LifecycleResult {
  const current = state ?? INITIAL;
  switch (event.type) {
    case 'inputs': {
      const inputs = { ...current.inputs, ...event.inputs };
      const leftMeeting = current.inputs.isMeeting && !inputs.isMeeting;
      const next: LifecycleState = {
        ...current,
        // Leaving the meeting route lets the next meeting auto-record again.
        ...(leftMeeting ? { ...NO_ENCODER_FAILURES, manuallyStopped: false } : {}),
        inputs,
        disconnectedSince: inputs.anyConnected ? null : (current.disconnectedSince ?? event.now),
      };
      return evaluate(next, config, event.now);
    }
    case 'tick':
      return evaluate(current, config, event.now);
    case 'command':
      return handleCommand(current, event.command);
    case 'pagehide':
      return current.status === 'recording' || current.status === 'paused'
        ? stop(current, 'pagehide')
        : { state: current, effects: [] };
    case 'recorderFailed':
      return current.status === 'recording' || current.status === 'paused'
        ? failRecorder(current, current.status, config, event.now)
        : { state: current, effects: [] };
    case 'restart':
      return current.status === 'recording' || current.status === 'paused'
        ? stop({ ...current, restartAs: current.status }, event.reason)
        : { state: current, effects: [] };
    case 'recorderStopped':
      return current.status === 'stopping'
        ? recorderStopped(current)
        : { state: current, effects: [] };
  }
}
