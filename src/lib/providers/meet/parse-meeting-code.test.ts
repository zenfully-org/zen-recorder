import { describe, expect, it } from 'vitest';
import { parseMeetingCode } from './parse-meeting-code';

describe('parseMeetingCode', () => {
  it.each([
    ['/abc-defg-hij', 'abc-defg-hij'],
    ['/abc-defg-hij/', 'abc-defg-hij'],
    ['/abc-defg-hij/extra', 'abc-defg-hij'],
    // Meet opens some meetings under `/meet/` since 2026-10 (a page saved from such a call).
    ['/meet/abc-defg-hij', 'abc-defg-hij'],
    ['/meet/abc-defg-hij/', 'abc-defg-hij'],
    ['/meet/abc-defg-hij/extra', 'abc-defg-hij'],
    ['/landing', null],
    ['/new', null],
    ['/_meet/abc-defg-hij', null],
    ['/meet/', null],
    ['/meet', null],
    ['/meet/ABC-DEFG-HIJ', null],
    ['/meet/landing', null],
    ['/meet/meet/abc-defg-hij', null],
    ['/other/abc-defg-hij', null],
    ['/', null],
    ['', null],
    ['/ABC-DEFG-HIJ', null],
    ['/abc-defg-hijk', null],
    ['/meet/abc-defg-hijk', null],
  ])('%j → %j', (path, expected) => {
    expect(parseMeetingCode(path)).toBe(expected);
  });
});
