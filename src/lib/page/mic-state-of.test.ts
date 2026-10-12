import { describe, expect, it } from 'vitest';
import { micStateOf } from './mic-state-of';

describe('micStateOf', () => {
  it.each([
    ['the mirrored microphone is on', { clone: { enabled: true } }, 'live'],
    ['the mirrored microphone is off: muted on the page', { clone: { enabled: false } }, 'muted'],
    ['the page holds no microphone open', null, 'not-connected'],
  ] as const)('says %s', (_label, mirror, state) => {
    expect(micStateOf(mirror)).toBe(state);
  });
});
