import { describe, expect, it } from 'vitest';
import { parseTapMessage } from './parse-tap-message';

describe('parseTapMessage', () => {
  it('reads a buffer of samples and the graph frame of its first sample', () => {
    const samples = new Float32Array([0.5, 0.25]);
    expect(parseTapMessage({ frame: 4096, samples })).toEqual({
      type: 'samples',
      data: samples,
      frame: 4096,
    });
  });

  it('reads the answer to a drain', () => {
    expect(parseTapMessage({ flushed: 3 })).toEqual({ type: 'drained', id: 3 });
  });

  it.each([
    ['a string', 'noise'],
    ['an answer without a whole id', { flushed: 1.5 }],
    ['an answer with a text id', { flushed: '1' }],
    ['other samples than f32', { frame: 0, samples: new Int16Array(2) }],
    ['samples without their frame', new Float32Array(2)],
    ['a frame that is not whole', { frame: 1.5, samples: new Float32Array(2) }],
    ['a negative frame', { frame: -128, samples: new Float32Array(2) }],
    ['nothing', undefined],
  ])('rejects %s', (_label, input) => {
    expect(parseTapMessage(input)).toBeNull();
  });
});
