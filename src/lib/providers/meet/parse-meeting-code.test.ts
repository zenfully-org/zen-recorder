import { describe, expect, it } from 'vitest';
import { parseMeetingCode } from './parse-meeting-code';

describe('parseMeetingCode', () => {
  it.each([
    ['/abc-defg-hij', 'abc-defg-hij'],
    ['/abc-defg-hij/', 'abc-defg-hij'],
    ['/abc-defg-hij/extra', 'abc-defg-hij'],
    ['/landing', null],
    ['/new', null],
    ['/_meet/abc-defg-hij', null],
    ['/', null],
    ['', null],
    ['/ABC-DEFG-HIJ', null],
    ['/abc-defg-hijk', null],
  ])('%j → %j', (path, expected) => {
    expect(parseMeetingCode(path)).toBe(expected);
  });
});
