import { describe, expect, it } from 'vitest';
import { parseZoomMeetingId } from './parse-zoom-meeting-id';

describe('parseZoomMeetingId', () => {
  it.each([
    // The web client keeps one URL from the preview screen until the user leaves.
    ['/wc/86866414938/join', '86866414938'],
    // The host's URL.
    ['/wc/83273473681/start', '83273473681'],
    ['/wc/1234567890/join/', '1234567890'],
    ['/wc/123456789', '123456789'],
    // Where the client goes after leaving, and its shell.
    ['/wc', null],
    ['/wc/', null],
    ['/wc/home', null],
    // Not the web client: the launcher, the account pages.
    ['/j/83273473681', null],
    ['/s/83273473681', null],
    ['/meeting', null],
    ['/signin', null],
    ['/', null],
    ['', null],
    // Not a meeting number.
    ['/wc/12345678/join', null],
    ['/wc/123456789012/join', null],
    ['/wc/86866414938x/join', null],
    ['/x/wc/86866414938/join', null],
  ])('%j → %j', (pathname, expected) => {
    expect(parseZoomMeetingId(pathname)).toBe(expected);
  });
});
