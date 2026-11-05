/**
 * `createPageSession` when Record is pressed (the popup, the status card or the keyboard shortcut)
 * on a page that names no meeting: a landing page, the page a call left for. A recording started
 * there stopped as "left the meeting" at the session's next reading of the page, a second later,
 * before its first sample, and saved a file with nothing in it. The page refuses it and says why.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setupPageSession as setup } from '@/test/page-session-harness';

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1_000_000);
});
afterEach(() => {
  vi.useRealTimers();
});

describe('createPageSession, Record on a page that names no meeting', () => {
  it('refuses it: nothing starts, and Diagnostics say why in one line', async () => {
    const { session, sent, logs, flush } = setup({ pathname: '/landing' });
    session.start();
    await flush();
    session.command('start');
    // A recording started there stopped at the next tick.
    await vi.advanceTimersByTimeAsync(1000);
    expect(sent.filter((m) => m.type === 'started' || m.type === 'ended')).toEqual([]);
    expect(session.getSnapshot()).toMatchObject({ state: 'idle', recordingId: null });
    expect(logs.filter((line) => line.includes('Record'))).toEqual([
      'info: Record refused: the page names no meeting to record',
    ]);
  });

  it('reads the page first: a meeting it shows since its last reading records', async () => {
    const { fakeWin, session, sent, flush } = setup({ pathname: '/landing' });
    session.start();
    await flush();
    // No navigation event: the session would see the meeting only at its next reading.
    fakeWin.location.pathname = '/abc-defg-hij';
    session.command('start');
    await flush();
    expect(sent.find((m) => m.type === 'started')?.data).toMatchObject({
      meetingCode: 'abc-defg-hij',
    });
    expect(session.getSnapshot().state).toBe('recording');
  });
});
