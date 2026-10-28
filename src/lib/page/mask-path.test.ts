import { describe, expect, it } from 'vitest';
import { maskPath } from './mask-path';

describe('maskPath', () => {
  it.each([
    ['/meet/abc-defg-hij', '/aaaa/aaa-aaaa-aaa'],
    ['/wc/86866414938/join', '/aa/00000000000/aaaa'],
    ['/', '/'],
    // Case, punctuation and percent escapes: only letters and digits are masked.
    ['/Ab_9.x~/%C3%A9', '/aa_0.a~/%a0%a0'],
    // A path Firefox did not escape: every script's letters and digits.
    ['/réunion/٣', '/aaaaaaa/0'],
  ])('%s → %s', (path, shape) => {
    expect(maskPath(path)).toBe(shape);
  });
});
