// @vitest-environment node
import { formatFileSize } from './format-file-size';

describe('formatFileSize', () => {
  it.each([
    [0, '0 bytes'],
    [999, '999 bytes'],
    [1_000, '1.0 kB'],
    [3_104, '3.1 kB'],
    [999_949, '999.9 kB'],
    [999_950, '1.0 MB'],
    [1_312_345, '1.3 MB'],
    [2_500_000_000, '2.5 GB'],
  ])('%i bytes read as %s', (bytes, expected) => {
    expect(formatFileSize(bytes)).toBe(expected);
  });
});
