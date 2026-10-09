import { describe, expect, it } from 'vitest';
import { leafOfPath } from './leaf-of-path';

describe('leafOfPath', () => {
  it.each([
    ['/srv/a/zen-recorder/X(1).webm', 'X(1).webm'],
    ['D:\\a\\zen-recorder\\X.webm', 'X.webm'],
    ['zen-recorder/X.webm', 'X.webm'],
    ['X.webm', 'X.webm'],
    ['/a/b/', ''],
  ])('takes the file name out of %s', (path, leaf) => {
    expect(leafOfPath(path)).toBe(leaf);
  });
});
