import { describe, expect, it } from 'vitest';
import { pickFinalizeStrategy } from './pick-finalize-strategy';

const MB = 1024 * 1024;

describe('pickFinalizeStrategy', () => {
  it.each([
    ['a small file', 10 * MB, true, 'buffer'],
    ['a small file without OPFS', 10 * MB, false, 'buffer'],
    ['exactly the streaming threshold', 64 * MB, true, 'buffer'],
    ['a large file with OPFS', 65 * MB, true, 'stream'],
    ['a medium file without OPFS', 300 * MB, false, 'buffer'],
    ['exactly the buffer limit without OPFS', 400 * MB, false, 'buffer'],
    ['a huge file without OPFS', 401 * MB, false, 'raw'],
    ['a huge file with OPFS', 2000 * MB, true, 'stream'],
  ])('picks for %s', (_label, byteSize, opfsAvailable, expected) => {
    expect(pickFinalizeStrategy({ byteSize, opfsAvailable })).toBe(expected);
  });

  it('honours custom thresholds', () => {
    expect(pickFinalizeStrategy({ byteSize: 5, opfsAvailable: true, streamAboveBytes: 4 })).toBe(
      'stream',
    );
    expect(pickFinalizeStrategy({ byteSize: 5, opfsAvailable: false, maxBufferBytes: 4 })).toBe(
      'raw',
    );
  });
});
