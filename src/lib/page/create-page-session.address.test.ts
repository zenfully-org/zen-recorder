/**
 * `createPageSession` in a call whose address names no meeting the provider knows: the provider
 * reads the user admitted but no meeting id, as Meet's did when Meet moved some meetings to a new
 * address. Nothing records there, and the page says so: once per address in Diagnostics, and in
 * its snapshot while it lasts, which the status card, the popup and the toolbar show.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeMeetingProvider } from '@/test/fakes/create-fake-meeting-provider';
import { setupPageSession as setup } from '@/test/page-session-harness';

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1_000_000);
});
afterEach(() => {
  vi.useRealTimers();
});

const LINE = /in a call, but the address names no meeting this version knows/;

describe('createPageSession, a call at an address the provider does not know', () => {
  // Only the first row is that call: the others are a meeting, a lobby, and a page that is none.
  it.each([
    { admitted: true, meetingId: null, lines: 1, unknownAddress: true, state: 'idle' },
    { admitted: false, meetingId: null, lines: 0, unknownAddress: false, state: 'idle' },
    { admitted: true, meetingId: 'call-1', lines: 0, unknownAddress: false, state: 'recording' },
    { admitted: false, meetingId: 'call-1', lines: 0, unknownAddress: false, state: 'waiting' },
  ])(
    'admitted $admitted, meeting $meetingId: $lines line, unknown address $unknownAddress, $state',
    async ({ admitted, meetingId, lines, unknownAddress, state }) => {
      const { provider } = createFakeMeetingProvider({ meetingId, admitted });
      const { session, logs, snapshots, startInCall } = setup({ provider, pathname: '/zz/x-1' });
      await startInCall();
      await vi.advanceTimersByTimeAsync(5_000);
      expect(logs.filter((line) => LINE.test(line))).toHaveLength(lines);
      expect(session.getSnapshot()).toMatchObject({ state });
      expect(snapshots.at(-1)?.unknownAddress === true).toBe(unknownAddress);
    },
  );

  it('says it once per address, with the shape of each, and the snapshot only while it lasts', async () => {
    const { provider, page } = createFakeMeetingProvider({ meetingId: null, admitted: false });
    const { session, win, fakeWin, logs, snapshots, startInCall } = setup({
      provider,
      pathname: '/zz/abc-defg-hij',
    });
    await startInCall();
    expect(snapshots.at(-1)).not.toHaveProperty('unknownAddress');
    page.meeting = { ...page.meeting, admitted: true };
    await vi.advanceTimersByTimeAsync(5_000);
    expect(snapshots.at(-1)).toMatchObject({ state: 'idle', unknownAddress: true });
    // Meet is a single-page app: it moves to another address without a load.
    fakeWin.location.pathname = '/call/2026/abc-defg-hij';
    win.history.pushState(null, '', fakeWin.location.pathname);
    await vi.advanceTimersByTimeAsync(5_000);
    const said = logs.filter((line) => LINE.test(line));
    expect(said).toEqual([
      expect.stringContaining('(host meet.google.com, path /aa/aaa-aaaa-aaa with'),
      expect.stringContaining('(host meet.google.com, path /aaaa/0000/aaa-aaaa-aaa with'),
    ]);
    expect(said.join()).not.toMatch(/abc-defg-hij|zz|2026/);
    page.meeting = { ...page.meeting, admitted: false };
    await vi.advanceTimersByTimeAsync(1_000);
    expect(snapshots.at(-1)).not.toHaveProperty('unknownAddress');
    expect(session.getSnapshot().state).toBe('idle');
  });
});
