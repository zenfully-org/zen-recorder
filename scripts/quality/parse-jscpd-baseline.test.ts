// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { parseJscpdBaseline } from './parse-jscpd-baseline';

describe('parseJscpdBaseline', () => {
  it('counts the clones the baseline knows: each fingerprint carries how many clones share it', () => {
    const text = JSON.stringify({
      version: 1,
      fingerprints: { '0c56ef31aa06c607': 1, '9a40aca8658ce27a': 2 },
    });
    expect(parseJscpdBaseline(text)).toEqual({ total: 3 });
  });

  it('refuses another shape', () => {
    expect(() => parseJscpdBaseline('{"fingerprints": [1]}')).toThrow(/\.jscpd-baseline\.json/);
  });
});
