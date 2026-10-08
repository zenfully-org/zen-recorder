import { describe, expect, it } from 'vitest';
import type { TabSnapshot } from '@/lib/types';
import { formatTabActivity } from './format-tab-activity';

function snapshot(patch: Partial<TabSnapshot>): TabSnapshot {
  return {
    state: 'recording',
    provider: 'meet',
    meetingCode: 'abc-defg-hij',
    title: 'Standup',
    recordingId: '4f3c6d2a-9d7c-4a4e-9f1e-0c1b2a3d4e5f',
    recordingStartedAt: 1_000,
    remoteTracks: 2,
    micLabel: null,
    connected: true,
    admitted: true,
    ...patch,
  };
}

describe('formatTabActivity', () => {
  it.each([
    ['a recording', snapshot({}), '01:05'],
    ['a paused recording', snapshot({ state: 'paused' }), '01:05'],
    [
      'a tab paused before its next recording',
      snapshot({ state: 'paused', recordingId: null, recordingStartedAt: null }),
      '2 remote audio',
    ],
    [
      'a recording whose start waits for the encoder probe',
      snapshot({ recordingId: null, recordingStartedAt: null }),
      '2 remote audio',
    ],
    ['a waiting tab', snapshot({ state: 'waiting', recordingId: null }), '2 remote audio'],
  ])('describes %s', (_label, snap, text) => {
    expect(formatTabActivity(snap, 66_000)).toBe(text);
  });
});
