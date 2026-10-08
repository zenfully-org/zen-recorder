import { describe, expect, it } from 'vitest';
import { canStartAudioContext } from './can-start-audio-context';

describe('canStartAudioContext', () => {
  it('asks the autoplay policy for audio contexts', () => {
    const asked: unknown[] = [];
    const navigator = {
      getAutoplayPolicy(type: unknown) {
        asked.push(type);
        return 'allowed';
      },
    };
    expect(canStartAudioContext(navigator)).toBe(true);
    expect(asked).toEqual(['audiocontext']);
  });

  it('is false while the browser would block a new context (no gesture, no capture yet)', () => {
    expect(canStartAudioContext({ getAutoplayPolicy: () => 'disallowed' })).toBe(false);
  });

  it('tries the context when the browser cannot say', () => {
    expect(canStartAudioContext({})).toBe(true);
    expect(canStartAudioContext({ getAutoplayPolicy: () => 'not a policy' })).toBe(true);
  });

  it('calls the policy on the navigator it belongs to', () => {
    const navigator = {
      allowed: true,
      getAutoplayPolicy(this: { allowed: boolean }) {
        return this.allowed ? 'allowed' : 'disallowed';
      },
    };
    expect(canStartAudioContext(navigator)).toBe(true);
  });
});
