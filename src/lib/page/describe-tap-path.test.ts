import { describe, expect, it } from 'vitest';
import type { AudioTap } from './create-audio-tap';
import { describeTapPath } from './describe-tap-path';

describe('describeTapPath', () => {
  it.each<[ReturnType<AudioTap['kind']>, ReturnType<AudioTap['module']>, string]>([
    ['worklet', 'blob', 'audio tap: worklet'],
    // A page whose policy refuses a blob module (Teams').
    ['worklet', 'file', "audio tap: worklet (the extension's file)"],
    ['processor', null, 'audio tap: processor'],
    ['pending', null, 'audio tap: pending'],
  ])('says the tap runs on its %s, from %s', (kind, module, line) => {
    expect(describeTapPath({ kind: () => kind, module: () => module })).toBe(line);
  });
});
