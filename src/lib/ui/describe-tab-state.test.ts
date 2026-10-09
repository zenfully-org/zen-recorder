import { describe, expect, it } from 'vitest';
import type { TabSnapshot } from '@/lib/types';
import { describeTabState } from './describe-tab-state';

function snapshot(patch: Partial<TabSnapshot>): TabSnapshot {
  return {
    state: 'waiting',
    provider: 'zoom',
    meetingCode: '1234567890',
    title: 'Standup',
    recordingId: null,
    recordingStartedAt: null,
    remoteTracks: 1,
    micLabel: null,
    connected: true,
    admitted: true,
    ...patch,
  };
}

describe('describeTabState', () => {
  it.each<[string, Partial<TabSnapshot>, string]>([
    ['recording', { state: 'recording' }, 'Recording'],
    ['paused', { state: 'paused' }, 'Paused'],
    ['saving', { state: 'stopping' }, 'Saving…'],
    ['waiting with someone else', { others: 1 }, 'Ready'],
    // Zoom plays everyone's audio through one element: a track even when nobody else is there.
    ['waiting alone with a remote audio track', { others: 0 }, 'Waiting for participants'],
    [
      'waiting alone, from a page older than the count of others',
      { remoteTracks: 0 },
      'Waiting for participants',
    ],
    ['waiting with a remote track, from a page older than the count', {}, 'Ready'],
    ['idle in a meeting', { state: 'idle' }, 'Not connected'],
    ['idle outside a meeting', { state: 'idle', meetingCode: null }, 'No meeting'],
  ])('says %s', (_label, patch, label) => {
    expect(describeTabState(snapshot(patch))).toBe(label);
  });
});
