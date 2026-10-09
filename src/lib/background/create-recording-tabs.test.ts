import { describe, expect, it } from 'vitest';
import type { TabToBackground } from '@/lib/types';
import { createRecordingTabs } from './create-recording-tabs';

const started = (recordingId: string): TabToBackground => ({
  type: 'recordingStarted',
  info: {
    recordingId,
    provider: 'meet',
    meetingCode: 'abc-defg-hij',
    title: 'Standup',
    startedAt: 5,
    mimeType: 'audio/webm',
    micLabel: null,
  },
});
const chunk = (recordingId: string): TabToBackground => ({
  type: 'chunk',
  chunk: { recordingId, seq: 0, blob: new Blob(['x']), timestampMs: 0 },
});
const ended = (recordingId: string): TabToBackground => ({
  type: 'recordingEnded',
  info: { recordingId, chunkCount: 1, durationMs: 1000, reason: 'command' },
});

/** Tabs 1 to 3 are connected; each tab's connection is named after it. */
const setup = () => createRecordingTabs((tabId) => (tabId <= 3 ? `tab ${tabId}` : undefined));

describe('createRecordingTabs', () => {
  it('finds the tab a recording comes from by its start, its chunks or its end', () => {
    const tabs = setup();
    tabs.claim(1, started('a'));
    tabs.claim(2, chunk('b'));
    tabs.claim(3, ended('c'));
    expect(['a', 'b', 'c'].map((id) => tabs.tabOf(id))).toEqual(['tab 1', 'tab 2', 'tab 3']);
  });

  it('finds no tab for a recording no tab sent anything about', () => {
    const tabs = setup();
    tabs.claim(1, { type: 'ping' });
    tabs.claim(1, { type: 'log', log: { level: 'info', message: 'a' } });
    expect(tabs.tabOf('a')).toBeUndefined();
  });

  it('finds no tab once the tab a recording comes from is no longer connected', () => {
    const tabs = setup();
    tabs.claim(4, started('a'));
    expect(tabs.tabOf('a')).toBeUndefined();
  });

  it('forgets the recordings heard of longest ago, past the last 100', () => {
    const tabs = setup();
    tabs.claim(1, started('long'));
    for (let n = 0; n < 99; n += 1) tabs.claim(2, started(`short ${n}`));
    // A recording that still sends its chunks is heard of again, so it is not the one forgotten.
    tabs.claim(1, chunk('long'));
    tabs.claim(2, started('one more'));
    expect(tabs.tabOf('long')).toBe('tab 1');
    expect(tabs.tabOf('short 0')).toBeUndefined();
    expect(tabs.tabOf('short 1')).toBe('tab 2');
  });
});
