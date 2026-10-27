import { describe, expect, it } from 'vitest';
import { createAddressReport } from './create-address-report';

/** A report on a page whose address the test moves, and the lines it wrote. */
function setup(pathname = '/zz/abc-defg-hij') {
  const location = { hostname: 'meet.google.com', pathname };
  const lines: string[] = [];
  const report = createAddressReport({
    readLocation: () => location,
    log: (level, message) => lines.push(`${level}: ${message}`),
  });
  return { location, lines, report };
}

const UNNAMED_CALL = { meetingId: null, admitted: true };

describe('createAddressReport', () => {
  it("says a call it cannot name records nothing, with the host and the path's shape", () => {
    const { lines, report } = setup();
    report(UNNAMED_CALL);
    expect(lines).toEqual([
      'warn: in a call, but the address names no meeting this version knows (host meet.google.com, path /aa/aaa-aaaa-aaa with letters as a and digits as 0): nothing records',
    ]);
  });

  // Diagnostics end up in public bug reports: the code, a name or a passcode in the path stay out.
  it('never writes the path itself', () => {
    const { lines, report } = setup('/meet/abc-defg-hij/Ana');
    report(UNNAMED_CALL);
    expect(lines.join()).not.toMatch(/meet\/|abc|Ana/);
  });

  it.each([
    ['a meeting the user is in', { meetingId: 'abc-defg-hij', admitted: true }],
    ['a meeting the user waits to join', { meetingId: 'abc-defg-hij', admitted: false }],
    ['a page that is no call', { meetingId: null, admitted: false }],
  ])('says nothing about %s', (_label, meeting) => {
    const { lines, report } = setup();
    report(meeting);
    expect(lines).toEqual([]);
  });

  it('says it once per address, again for another one', () => {
    const { location, lines, report } = setup();
    report(UNNAMED_CALL);
    report(UNNAMED_CALL);
    // The call UI goes away and comes back at the same address.
    report({ meetingId: null, admitted: false });
    report(UNNAMED_CALL);
    expect(lines).toHaveLength(1);
    location.pathname = '/call/2026/abc-defg-hij';
    report(UNNAMED_CALL);
    location.pathname = '/zz/abc-defg-hij';
    report(UNNAMED_CALL);
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain('path /aaaa/0000/aaa-aaaa-aaa with');
  });
});
