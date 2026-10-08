import { describe, expect, it } from 'vitest';
import { pickMimeType } from './pick-mime-type';

describe('pickMimeType', () => {
  it('prefers Opus in WebM', () => {
    expect(pickMimeType(() => true)).toBe('audio/webm;codecs=opus');
  });

  it('falls back down the list', () => {
    expect(pickMimeType((t) => t === 'audio/ogg;codecs=opus')).toBe('audio/ogg;codecs=opus');
  });

  it('returns an empty string when nothing is supported', () => {
    expect(pickMimeType(() => false)).toBe('');
  });
});
