import { describe, expect, it } from 'vitest';
import {
  type LifecycleConfig,
  type LifecycleEffect,
  type LifecycleEvent,
  type LifecycleState,
  reduceLifecycle,
} from './reduce-lifecycle';

const config: LifecycleConfig = {
  autoRecord: true,
  startRule: 'firstRemote',
  deadConnectionGraceMs: 5000,
  maxEncoderRestarts: 3,
  encoderFailureWindowMs: 60_000,
};

/** Runs a sequence of events; returns the final state and the effects of the last event. */
function run(
  events: LifecycleEvent[],
  cfg: LifecycleConfig = config,
): { state: LifecycleState; effects: LifecycleEffect[] } {
  let state: LifecycleState | undefined;
  let effects: LifecycleEffect[] = [];
  for (const event of events) {
    ({ state, effects } = reduceLifecycle(state, event, cfg));
  }
  if (!state) throw new Error('no events');
  return { state, effects };
}

const joined: LifecycleEvent = {
  type: 'inputs',
  inputs: { isMeeting: true, anyConnected: true, admitted: true },
  now: 0,
};
const knocking: LifecycleEvent = {
  type: 'inputs',
  inputs: { isMeeting: true, anyConnected: true, admitted: false },
  now: 0,
};
const remote: LifecycleEvent = { type: 'inputs', inputs: { remoteAudioTracks: 1 }, now: 1 };
/** The encoder fails at `now` and the session reports the recorder stopped right after. */
const encoderFails = (now: number): LifecycleEvent[] => [
  { type: 'recorderFailed', now },
  { type: 'recorderStopped', now: now + 1 },
];

describe('reduceLifecycle', () => {
  it('waits for the first remote audio track before recording (firstRemote rule)', () => {
    const waiting = run([joined]);
    expect(waiting.effects).toEqual([]);
    expect(waiting.state.status).toBe('waiting');
    const recording = run([joined, remote]);
    expect(recording.effects).toEqual([{ type: 'startRecording' }]);
    expect(recording.state.status).toBe('recording');
  });

  it('does not auto-start while still knocking in the lobby, but a manual start works', () => {
    expect(run([knocking, remote]).effects).toEqual([]);
    expect(run([knocking, remote]).state.status).toBe('waiting');
    expect(run([knocking], { ...config, startRule: 'onJoin' }).effects).toEqual([]);
    const admitted = run([knocking, remote, { ...joined, now: 2 }]);
    expect(admitted.effects).toEqual([{ type: 'startRecording' }]);
    const manual = run([knocking, { type: 'command', command: 'start', now: 1 }]);
    expect(manual.effects).toEqual([{ type: 'startRecording' }]);
  });

  it('starts as soon as connected with the onJoin rule', () => {
    expect(run([joined], { ...config, startRule: 'onJoin' }).effects).toEqual([
      { type: 'startRecording' },
    ]);
  });

  it('stays idle while not on a meeting route', () => {
    const r = run([{ type: 'inputs', inputs: { anyConnected: true }, now: 0 }]);
    expect(r.state.status).toBe('idle');
  });

  it('does not auto start when autoRecord is off, but a manual start works', () => {
    const cfg = { ...config, autoRecord: false };
    expect(run([joined, remote], cfg).state.status).toBe('waiting');
    expect(
      run([joined, remote, { type: 'command', command: 'start', now: 2 }], cfg).effects,
    ).toEqual([{ type: 'startRecording' }]);
  });

  it.each([
    ['pause', false, 'paused', [{ type: 'pauseRecording' }]],
    ['resume', true, 'recording', [{ type: 'resumeRecording' }]],
    ['stop', false, 'stopping', [{ type: 'stopRecording', reason: 'command' }]],
    ['stop', true, 'stopping', [{ type: 'stopRecording', reason: 'command' }]],
    ['pause', true, 'paused', []],
    ['resume', false, 'recording', []],
    ['start', false, 'recording', []],
  ] as const)('command %s (paused first: %s) → %s', (command, pauseFirst, status, expected) => {
    const events: LifecycleEvent[] = [joined, remote];
    if (pauseFirst) events.push({ type: 'command', command: 'pause', now: 2 });
    events.push({ type: 'command', command, now: 3 });
    const r = run(events);
    expect(r.effects).toEqual(expected);
    expect(r.state.status).toBe(status);
  });

  it('ignores commands that do not apply to the current status', () => {
    expect(run([{ type: 'command', command: 'stop', now: 0 }]).effects).toEqual([]);
    expect(run([{ type: 'command', command: 'pause', now: 0 }]).effects).toEqual([]);
    expect(run([{ type: 'command', command: 'resume', now: 0 }]).effects).toEqual([]);
  });

  it('stops when the meeting route is left and returns to idle after the recorder stops', () => {
    const left = run([joined, remote, { type: 'inputs', inputs: { isMeeting: false }, now: 2 }]);
    expect(left.effects).toEqual([{ type: 'stopRecording', reason: 'left-meeting' }]);
    const idle = run([
      joined,
      remote,
      { type: 'inputs', inputs: { isMeeting: false }, now: 2 },
      { type: 'recorderStopped', now: 3 },
    ]);
    expect(idle.state.status).toBe('idle');
  });

  it('stops only after the dead-connection grace period', () => {
    const base: LifecycleEvent[] = [
      joined,
      remote,
      { type: 'inputs', inputs: { anyConnected: false }, now: 1000 },
    ];
    expect(run(base).effects).toEqual([]);
    expect(run([...base, { type: 'tick', now: 3000 }]).effects).toEqual([]);
    expect(run([...base, { type: 'tick', now: 6001 }]).effects).toEqual([
      { type: 'stopRecording', reason: 'connections-lost' },
    ]);
  });

  it('keeps the first disconnect time while still disconnected', () => {
    const r = run([
      joined,
      remote,
      { type: 'inputs', inputs: { anyConnected: false }, now: 1000 },
      { type: 'inputs', inputs: { remoteAudioTracks: 0 }, now: 2000 },
    ]);
    expect(r.state.disconnectedSince).toBe(1000);
  });

  it('survives a brief reconnection without stopping', () => {
    const r = run([
      joined,
      remote,
      { type: 'inputs', inputs: { anyConnected: false }, now: 1000 },
      { type: 'inputs', inputs: { anyConnected: true }, now: 3000 },
      { type: 'tick', now: 20_000 },
    ]);
    expect(r.effects).toEqual([]);
    expect(r.state.status).toBe('recording');
  });

  it('goes back to idle from waiting when connections stay dead', () => {
    const r = run([
      joined,
      { type: 'inputs', inputs: { anyConnected: false }, now: 100 },
      { type: 'tick', now: 10_000 },
    ]);
    expect(r.state.status).toBe('idle');
  });

  it('goes back to idle from waiting when the route is left', () => {
    const r = run([joined, { type: 'inputs', inputs: { isMeeting: false }, now: 100 }]);
    expect(r.state.status).toBe('idle');
  });

  it('does not auto-restart in the same meeting after a manual stop, but does in a new one', () => {
    const stopped: LifecycleEvent[] = [
      joined,
      remote,
      { type: 'command', command: 'stop', now: 2 },
      { type: 'recorderStopped', now: 3 },
    ];
    expect(run(stopped).state.status).toBe('waiting');
    expect(
      run([...stopped, { type: 'inputs', inputs: { remoteAudioTracks: 2 }, now: 4 }]).effects,
    ).toEqual([]);
    const newMeeting: LifecycleEvent[] = [
      ...stopped,
      {
        type: 'inputs',
        inputs: { isMeeting: false, anyConnected: false, remoteAudioTracks: 0 },
        now: 5,
      },
      { ...joined, now: 6 },
      { ...remote, now: 7 },
    ];
    expect(run(newMeeting).effects).toEqual([{ type: 'startRecording' }]);
  });

  it('keeps a manual recording alive while alone: no connection was ever established', () => {
    const alone: LifecycleEvent[] = [
      { type: 'inputs', inputs: { isMeeting: true }, now: 0 },
      { type: 'command', command: 'start', now: 1 },
    ];
    expect(run(alone).state.status).toBe('recording');
    expect(run([...alone, { type: 'tick', now: 60_000 }]).effects).toEqual([]);
    expect(run([...alone, { type: 'tick', now: 60_000 }]).state.status).toBe('recording');
  });

  it('applies the connection-loss rule to a manual recording once a connection existed', () => {
    const events: LifecycleEvent[] = [
      { type: 'inputs', inputs: { isMeeting: true }, now: 0 },
      { type: 'command', command: 'start', now: 1 },
      { type: 'inputs', inputs: { anyConnected: true }, now: 2 },
      { type: 'inputs', inputs: { anyConnected: false }, now: 3 },
    ];
    expect(run([...events, { type: 'tick', now: 4 }]).effects).toEqual([]);
    expect(run([...events, { type: 'tick', now: 9000 }]).effects).toEqual([
      { type: 'stopRecording', reason: 'connections-lost' },
    ]);
  });

  it('flushes on pagehide only while recording or paused', () => {
    expect(run([joined, remote, { type: 'pagehide', now: 2 }]).effects).toEqual([
      { type: 'stopRecording', reason: 'pagehide' },
    ]);
    expect(run([joined, { type: 'pagehide', now: 2 }]).effects).toEqual([]);
  });

  it('stops with encoder-error on recorderFailed while recording or paused, without a manual stop', () => {
    const recording = run([joined, remote]);
    const failed = reduceLifecycle(recording.state, { type: 'recorderFailed', now: 2 }, config);
    expect(failed.effects).toEqual([{ type: 'stopRecording', reason: 'encoder-error' }]);
    expect(failed.state.status).toBe('stopping');
    expect(failed.state.manuallyStopped).toBe(false);
    const paused = reduceLifecycle(
      recording.state,
      { type: 'command', command: 'pause', now: 2 },
      config,
    );
    expect(
      reduceLifecycle(paused.state, { type: 'recorderFailed', now: 3 }, config).effects,
    ).toEqual([{ type: 'stopRecording', reason: 'encoder-error' }]);
    const idle = reduceLifecycle(undefined, { type: 'recorderFailed', now: 0 }, config);
    expect(idle.effects).toEqual([]);
  });

  it('restarts the recording once the failed recorder stopped, without a manual stop', () => {
    const r = run([joined, remote, ...encoderFails(2)]);
    expect(r.effects).toEqual([{ type: 'startRecording' }]);
    expect(r.state).toMatchObject({ status: 'recording', manuallyStopped: false });
  });

  it('restarts a recording that failed while paused in paused: nothing is recorded until Resume', () => {
    const paused: LifecycleEvent[] = [
      joined,
      remote,
      { type: 'command', command: 'pause', now: 2 },
    ];
    const r = run([...paused, ...encoderFails(3)]);
    expect(r.effects).toEqual([{ type: 'startRecording' }]);
    expect(r.state).toMatchObject({ status: 'paused', manuallyStopped: false });
    // An encoder that fails again (or cannot start) keeps the restart paused.
    expect(run([...paused, ...encoderFails(3), ...encoderFails(4)]).state.status).toBe('paused');
    expect(
      run([...paused, ...encoderFails(3), { type: 'command', command: 'resume', now: 4 }]).effects,
    ).toEqual([{ type: 'resumeRecording' }]);
  });

  it('gives up on a paused recording like on a running one: no restart, back to waiting', () => {
    const r = run([
      joined,
      remote,
      { type: 'command', command: 'pause', now: 2 },
      ...encoderFails(3),
      ...encoderFails(4),
      ...encoderFails(5),
      ...encoderFails(6),
    ]);
    expect(r.effects).toEqual([]);
    expect(r.state.status).toBe('waiting');
  });

  it.each([
    ['pause', 'recording', 'paused'],
    ['resume', 'paused', 'recording'],
    ['pause', 'paused', 'paused'],
    ['resume', 'recording', 'recording'],
    // Record changes nothing: the recording is coming back anyway.
    ['start', 'paused', 'paused'],
  ] as const)('honours %s while restarting from %s: it restarts %s', (command, before, after) => {
    const events: LifecycleEvent[] = [joined, remote];
    if (before === 'paused') events.push({ type: 'command', command: 'pause', now: 2 });
    const r = run([
      ...events,
      { type: 'recorderFailed', now: 3 },
      { type: 'command', command, now: 4 },
      { type: 'recorderStopped', now: 5 },
    ]);
    expect(r.effects).toEqual([{ type: 'startRecording' }]);
    expect(r.state.status).toBe(after);
  });

  it.each([
    ['running', []],
    ['paused', [{ type: 'command', command: 'pause', now: 2 }]],
  ] as const)(
    'honours a Stop while a %s recording restarts: no restart, a manual stop',
    (_name, before) => {
      const stopping = run([
        joined,
        remote,
        ...before,
        { type: 'recorderFailed', now: 3 },
        { type: 'command', command: 'stop', now: 4 },
      ]);
      // The recorder is already stopping: no second stop effect.
      expect(stopping.effects).toEqual([]);
      expect(stopping.state.status).toBe('stopping');
      const stopped = reduceLifecycle(stopping.state, { type: 'recorderStopped', now: 5 }, config);
      expect(stopped.effects).toEqual([]);
      expect(stopped.state).toMatchObject({ status: 'waiting', manuallyStopped: true });
    },
  );

  it('ignores commands while a recording stops for good', () => {
    const stopping = run([joined, remote, { type: 'pagehide', now: 2 }]);
    for (const command of ['pause', 'resume', 'stop', 'start'] as const) {
      const r = reduceLifecycle(stopping.state, { type: 'command', command, now: 3 }, config);
      expect(r).toEqual({ state: stopping.state, effects: [] });
    }
  });

  it('restarts a recording started by hand even when auto-record is off', () => {
    const cfg = { ...config, autoRecord: false };
    const events: LifecycleEvent[] = [joined, { type: 'command', command: 'start', now: 1 }];
    expect(run([...events, ...encoderFails(2)], cfg).effects).toEqual([{ type: 'startRecording' }]);
  });

  it.each([
    ['had a connection', [joined], true],
    ['was started by hand alone', [{ type: 'inputs', inputs: { isMeeting: true }, now: 0 }], false],
  ] as const)(
    'a restarted recording that %s keeps that for the connection-loss rule',
    (_name, before, connected) => {
      const r = run([
        ...before,
        { type: 'command', command: 'start', now: 1 },
        { type: 'inputs', inputs: { anyConnected: false }, now: 2 },
        ...encoderFails(3),
      ]);
      expect(r.state).toMatchObject({ status: 'recording', connectedDuringRecording: connected });
    },
  );

  it('does not restart when the meeting was left while the failed recorder stopped', () => {
    const r = run([
      joined,
      remote,
      { type: 'recorderFailed', now: 2 },
      { type: 'inputs', inputs: { isMeeting: false }, now: 3 },
      { type: 'recorderStopped', now: 4 },
    ]);
    expect(r.effects).toEqual([]);
    expect(r.state.status).toBe('idle');
  });

  it('gives up after the restart budget: no restart and no auto-start until Record or another meeting', () => {
    const broken: LifecycleEvent[] = [
      joined,
      remote,
      ...encoderFails(2),
      ...encoderFails(10),
      ...encoderFails(20),
    ];
    expect(run(broken).effects).toEqual([{ type: 'startRecording' }]);
    const exhausted = run([...broken, { type: 'recorderFailed', now: 30 }]);
    expect(exhausted.effects).toEqual([
      { type: 'stopRecording', reason: 'encoder-error' },
      { type: 'restartsExhausted', failures: 4 },
    ]);
    const gaveUp = [...broken, ...encoderFails(30)];
    expect(run(gaveUp).effects).toEqual([]);
    expect(run(gaveUp).state).toMatchObject({ status: 'waiting', manuallyStopped: false });
    expect(
      run([...gaveUp, { type: 'inputs', inputs: { remoteAudioTracks: 2 }, now: 40 }]).effects,
    ).toEqual([]);
    expect(run([...gaveUp, { type: 'tick', now: 3_600_000 }]).effects).toEqual([]);
    // Record by hand gets a full budget again.
    const manual: LifecycleEvent[] = [...gaveUp, { type: 'command', command: 'start', now: 50 }];
    expect(run(manual).effects).toEqual([{ type: 'startRecording' }]);
    expect(run([...manual, ...encoderFails(60)]).effects).toEqual([{ type: 'startRecording' }]);
    // So does the next meeting.
    const nextMeeting: LifecycleEvent[] = [
      ...gaveUp,
      { type: 'inputs', inputs: { isMeeting: false, anyConnected: false }, now: 50 },
      { ...joined, now: 60 },
    ];
    expect(run(nextMeeting).effects).toEqual([{ type: 'startRecording' }]);
    expect(run([...nextMeeting, ...encoderFails(70)]).effects).toEqual([
      { type: 'startRecording' },
    ]);
  });

  it('counts a failure a full window (60 s) after the previous one as the first of a new run', () => {
    const events: LifecycleEvent[] = [joined, remote];
    for (const minute of [1, 2, 3, 4, 5, 6]) events.push(...encoderFails(minute * 60_000));
    const r = run(events);
    expect(r.effects).toEqual([{ type: 'startRecording' }]);
    expect(r.state.encoderFailures).toBe(1);
  });

  it('ignores recorderStopped outside of stopping', () => {
    const r = run([joined, remote, { type: 'recorderStopped', now: 2 }]);
    expect(r.state.status).toBe('recording');
  });

  it('ignores ticks while stopping', () => {
    const r = run([joined, remote, { type: 'pagehide', now: 2 }, { type: 'tick', now: 99_999 }]);
    expect(r.effects).toEqual([]);
    expect(r.state.status).toBe('stopping');
  });
});

describe('reduceLifecycle restarting a recording for the page backlog', () => {
  it.each([
    ['its backlog is full', 'backlog-full'],
    ['the extension took that backlog, to record video again', 'video-back'],
  ] as const)(
    'stops a recording when %s, and starts the next one in its status, without counting an encoder failure',
    (_label, reason) => {
      const full: LifecycleEvent[] = [joined, remote, { type: 'restart', reason, now: 2 }];
      const stopping = run(full);
      expect(stopping.effects).toEqual([{ type: 'stopRecording', reason }]);
      expect(stopping.state).toMatchObject({
        status: 'stopping',
        manuallyStopped: false,
        encoderFailures: 0,
      });
      const restarted = run([...full, { type: 'recorderStopped', now: 3 }]);
      expect(restarted.effects).toEqual([{ type: 'startRecording' }]);
      expect(restarted.state).toMatchObject({ status: 'recording', encoderFailures: 0 });
      // A paused recording comes back paused: nothing records until Resume.
      const paused = run([
        joined,
        remote,
        { type: 'command', command: 'pause', now: 2 },
        { type: 'restart', reason, now: 3 },
        { type: 'recorderStopped', now: 4 },
      ]);
      expect(paused.effects).toEqual([{ type: 'startRecording' }]);
      expect(paused.state.status).toBe('paused');
      // A Stop pressed while the recording stops is a Stop.
      const stopped = run([
        ...full,
        { type: 'command', command: 'stop', now: 3 },
        { type: 'recorderStopped', now: 4 },
      ]);
      expect(stopped.effects).toEqual([]);
      expect(stopped.state).toMatchObject({ status: 'waiting', manuallyStopped: true });
    },
  );

  it('ignores a restart when nothing records', () => {
    expect(run([joined, { type: 'restart', reason: 'backlog-full', now: 2 }]).effects).toEqual([]);
    const stopping = run([joined, remote, { type: 'pagehide', now: 2 }]);
    expect(
      reduceLifecycle(stopping.state, { type: 'restart', reason: 'video-back', now: 3 }, config)
        .effects,
    ).toEqual([]);
  });
});

describe('reduceLifecycle: inputs that repeat the ones it holds', () => {
  // A page session that dispatched `inputs` on every tick, instead of only when one changed,
  // would hand the reducer what it already holds. That must be a tick, from any status.
  const stop: LifecycleEvent = { type: 'command', command: 'stop', now: 2 };
  const states: Record<string, LifecycleEvent[]> = {
    idle: [{ type: 'inputs', inputs: { isMeeting: false }, now: 0 }],
    waiting: [joined],
    recording: [joined, remote],
    paused: [joined, remote, { type: 'command', command: 'pause', now: 2 }],
    'recording, the call lost': [
      joined,
      remote,
      { type: 'inputs', inputs: { anyConnected: false }, now: 2 },
    ],
    stopping: [joined, remote, stop],
    'stopping, to restart after a failure': [joined, remote, { type: 'recorderFailed', now: 2 }],
    'waiting, after a Stop': [joined, remote, stop, { type: 'recorderStopped', now: 3 }],
  };

  it.each(Object.entries(states))('takes them for a tick: %s', (_, events) => {
    const { state } = run(events);
    for (const now of [4, 4_000, 9_000]) {
      const repeated = reduceLifecycle(
        state,
        { type: 'inputs', inputs: state.inputs, now },
        config,
      );
      expect(repeated).toEqual(reduceLifecycle(state, { type: 'tick', now }, config));
    }
  });
});
