import { describe, expect, it } from 'vitest';
import { parseChunkMessage } from './parse-chunk-message';

const valid = {
  recordingId: '4f3c6d2a-9d7c-4a4e-9f1e-0c1b2a3d4e5f',
  seq: 3,
  blob: new Blob(['abc']),
  timestampMs: 9000,
};

describe('parseChunkMessage', () => {
  it('accepts a valid chunk and keeps the Blob instance', () => {
    const parsed = parseChunkMessage(valid);
    expect(parsed?.blob).toBe(valid.blob);
    expect(parsed?.seq).toBe(3);
  });

  it.each([
    ['a negative seq', { ...valid, seq: -1 }],
    ['a fractional seq', { ...valid, seq: 1.5 }],
    ['a non-Blob payload', { ...valid, blob: 'data' }],
    ['a bad id', { ...valid, recordingId: 'x' }],
  ])('rejects %s', (_label, input) => {
    expect(parseChunkMessage(input)).toBeNull();
  });
});
