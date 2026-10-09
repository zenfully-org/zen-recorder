import { describe, expect, it } from 'vitest';
import type { TabSnapshot } from '@/lib/types';
import { parseTabSnapshot } from './parse-tab-snapshot';

const valid: TabSnapshot = {
  state: 'recording',
  provider: 'meet',
  meetingCode: 'abc-defg-hij',
  title: 'Standup',
  recordingId: 'r1',
  recordingStartedAt: 1,
  remoteTracks: 2,
  micLabel: null,
  connected: true,
  admitted: true,
};

describe('parseTabSnapshot', () => {
  it('accepts a valid snapshot', () => {
    expect(parseTabSnapshot(valid)).toEqual(valid);
  });

  it('defaults fields an older page session does not send yet', () => {
    const { admitted: _omitted, provider: _unknown, ...legacy } = valid;
    expect(parseTabSnapshot(legacy)).toEqual({ ...valid, admitted: true, provider: 'meet' });
  });

  it('accepts the stopped recordings whose chunks the page still delivers', () => {
    const draining = { ...valid, recordingId: 'r3', pendingRecordingIds: ['r1', 'r2'] };
    expect(parseTabSnapshot(draining)).toEqual(draining);
  });

  it.each(['audio-only', 'waiting'] as const)(
    'accepts a page whose backlog is full and that records %s',
    (backlogFull) => {
      expect(parseTabSnapshot({ ...valid, backlogFull })).toEqual({ ...valid, backlogFull });
    },
  );

  it('leaves the full backlog out of a snapshot from a page session older than it', () => {
    expect(parseTabSnapshot(valid)).not.toHaveProperty('backlogFull');
  });

  it('accepts a page whose recorder gave up on a broken encoder', () => {
    const gaveUp = { ...valid, recordingId: null, encoderGaveUp: true };
    expect(parseTabSnapshot(gaveUp)).toEqual(gaveUp);
  });

  it('leaves the encoder that gave up out of a snapshot from a page session older than it', () => {
    expect(parseTabSnapshot(valid)).not.toHaveProperty('encoderGaveUp');
  });

  it.each(['zoom', 'teams'] as const)('accepts a snapshot from %s', (provider) => {
    expect(parseTabSnapshot({ ...valid, provider })).toEqual({ ...valid, provider });
  });

  it('accepts the people in the meeting besides the user, as the lifecycle counts them', () => {
    expect(parseTabSnapshot({ ...valid, others: 0 })).toEqual({ ...valid, others: 0 });
  });

  it('leaves the count of others out of a snapshot from a page session older than it', () => {
    expect(parseTabSnapshot(valid)).not.toHaveProperty('others');
  });

  it('accepts a video tile count', () => {
    expect(parseTabSnapshot({ ...valid, videoTiles: 3 })).toEqual({ ...valid, videoTiles: 3 });
  });

  it.each([
    ['unknown state', { ...valid, state: 'boom' }],
    ['unknown provider', { ...valid, provider: 'webex' }],
    ['negative tile count', { ...valid, videoTiles: -1 }],
    ['negative track count', { ...valid, remoteTracks: -1 }],
    ['negative count of others', { ...valid, others: -1 }],
    ['pending recording that is not an id', { ...valid, pendingRecordingIds: [7] }],
    ['unknown full backlog', { ...valid, backlogFull: 'video' }],
    ['an encoder that gave up, said otherwise', { ...valid, encoderGaveUp: 'yes' }],
    ['missing field', { ...valid, title: undefined }],
    ['not an object', 'x'],
  ])('rejects %s', (_label, input) => {
    expect(parseTabSnapshot(input)).toBeNull();
  });
});
