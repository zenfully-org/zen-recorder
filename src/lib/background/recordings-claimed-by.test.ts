import { describe, expect, it } from 'vitest';
import type { TabSnapshot } from '@/lib/types';
import { recordingsClaimedBy } from './recordings-claimed-by';

const tab = (patch: Partial<TabSnapshot>): TabSnapshot => ({
  state: 'recording',
  provider: 'meet',
  meetingCode: 'abc-defg-hij',
  title: 'Standup',
  recordingId: null,
  recordingStartedAt: null,
  remoteTracks: 1,
  micLabel: null,
  connected: true,
  admitted: true,
  ...patch,
});

describe('recordingsClaimedBy', () => {
  it.each([
    { name: 'no tab', tabs: [], claimed: [] },
    { name: 'a tab not known yet', tabs: [null], claimed: [] },
    { name: 'a tab that records nothing', tabs: [tab({ state: 'waiting' })], claimed: [] },
    { name: 'the recording a tab writes', tabs: [tab({ recordingId: 'r1' })], claimed: ['r1'] },
    {
      name: 'the stopped recordings whose chunks a tab still delivers, after the one it writes',
      tabs: [tab({ recordingId: 'r3', pendingRecordingIds: ['r1', 'r2'] })],
      claimed: ['r3', 'r1', 'r2'],
    },
    {
      name: 'stopped recordings of a tab that writes none now',
      tabs: [tab({ state: 'stopping', pendingRecordingIds: ['r1'] })],
      claimed: ['r1'],
    },
    {
      name: 'every tab',
      tabs: [
        tab({ recordingId: 'r1' }),
        null,
        tab({ recordingId: 'r2', pendingRecordingIds: ['r0'] }),
      ],
      claimed: ['r1', 'r2', 'r0'],
    },
  ])('claims $name', ({ tabs, claimed }) => {
    expect(recordingsClaimedBy(tabs)).toEqual(claimed);
  });
});
