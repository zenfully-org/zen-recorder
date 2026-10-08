import { describe, expect, it } from 'vitest';
import { extensionForMimeType } from './extension-for-mime-type';

describe('extensionForMimeType', () => {
  it.each([
    ['audio/webm;codecs=opus', 'webm'],
    ['audio/ogg; codecs=opus', 'ogg'],
    ['AUDIO/OGG', 'ogg'],
    ['video/webm;codecs=vp8,opus', 'webm'],
    ['', 'webm'],
  ])('%j → %j', (mime, ext) => {
    expect(extensionForMimeType(mime)).toBe(ext);
  });
});
