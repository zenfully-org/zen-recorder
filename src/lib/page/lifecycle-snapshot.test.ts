import { describe, expect, it } from 'vitest';
import type { LifecycleState } from '@/lib/page/reduce-lifecycle';
import { lifecycleSnapshot } from './lifecycle-snapshot';

const config = { maxEncoderRestarts: 3 };
const lifecycle = (patch: Partial<LifecycleState> = {}): LifecycleState => ({
  status: 'recording',
  inputs: { isMeeting: true, anyConnected: true, remoteAudioTracks: 1, admitted: true },
  manuallyStopped: false,
  disconnectedSince: null,
  connectedDuringRecording: true,
  encoderFailures: 0,
  encoderFailedAt: null,
  restartAs: null,
  ...patch,
});

describe('lifecycleSnapshot', () => {
  it('says idle and not admitted before the lifecycle started', () => {
    expect(lifecycleSnapshot(undefined, config)).toEqual({ state: 'idle', admitted: false });
  });

  it('says the status and whether the call admitted the user', () => {
    expect(lifecycleSnapshot(lifecycle(), config)).toEqual({ state: 'recording', admitted: true });
  });

  it('says the recorder gave up once the encoder failed past its restarts', () => {
    const gaveUp = lifecycle({ status: 'waiting', encoderFailures: 4, encoderFailedAt: 10 });
    expect(lifecycleSnapshot(gaveUp, config)).toEqual({
      state: 'waiting',
      admitted: true,
      encoderGaveUp: true,
    });
    const restarting = lifecycle({ encoderFailures: 3, encoderFailedAt: 10 });
    expect(lifecycleSnapshot(restarting, config)).not.toHaveProperty('encoderGaveUp');
  });
});
