import { describe, expect, it } from 'vitest';
import { parseMeetingEvent } from './parse-meeting-event';

const stamp = { seq: 3, atMs: 1_700_000_000_000, mediaMs: 2_500 };
const UNKNOWN = {
  cause: null,
  media: null,
  audioOnlyReason: null,
  continuesRecordingId: null,
  gapMs: null,
  mic: null,
  tabVisible: null,
  ownShare: null,
};
const known = {
  cause: 'restart-after-video-failure',
  media: 'audio',
  audioOnlyReason: 'video-failed',
  continuesRecordingId: '4f3c6d2a-9d7c-4a4e-9f1e-0c1b2a3d4e5f',
  gapMs: 140,
  mic: 'muted',
  tabVisible: false,
  ownShare: true,
};

describe('parseMeetingEvent', () => {
  it.each([
    [
      'a start in the shape the first notes release sent: nothing known about it',
      { ...stamp, type: 'recording-started' },
      { ...stamp, type: 'recording-started', ...UNKNOWN },
    ],
    [
      'a start with what the page knew',
      { ...stamp, type: 'recording-started', ...known },
      { ...stamp, type: 'recording-started', ...known },
    ],
    [
      'a start with facts this build cannot read: not known, the start kept',
      {
        ...stamp,
        type: 'recording-started',
        cause: 'teleported',
        media: 'smell',
        audioOnlyReason: 7,
        continuesRecordingId: '',
        gapMs: -1,
        mic: 'loud',
        tabVisible: 'yes',
        ownShare: 0,
      },
      { ...stamp, type: 'recording-started', ...UNKNOWN },
    ],
    [
      'a stop',
      { ...stamp, type: 'recording-stopped', reason: 'encoder-error' },
      { ...stamp, type: 'recording-stopped', reason: 'encoder-error' },
    ],
    ['a video failure', { ...stamp, type: 'video-failed' }, { ...stamp, type: 'video-failed' }],
    [
      'the restarts given up',
      { ...stamp, type: 'restarts-exhausted', failures: 4 },
      { ...stamp, type: 'restarts-exhausted', failures: 4 },
    ],
    [
      'a pause and a resume',
      { ...stamp, type: 'recording-resumed', pausedMs: 4_000 },
      { ...stamp, type: 'recording-resumed', pausedMs: 4_000 },
    ],
    ['a pause', { ...stamp, type: 'recording-paused' }, { ...stamp, type: 'recording-paused' }],
    [
      'a lost connection',
      { ...stamp, type: 'connection-lost' },
      { ...stamp, type: 'connection-lost' },
    ],
    [
      'a restored connection',
      { ...stamp, type: 'connection-restored', lostMs: 3_000 },
      { ...stamp, type: 'connection-restored', lostMs: 3_000 },
    ],
    [
      'an extension reload',
      { ...stamp, type: 'extension-reloaded' },
      { ...stamp, type: 'extension-reloaded' },
    ],
    [
      'an event seen while paused',
      { ...stamp, type: 'video-failed', paused: true },
      { ...stamp, type: 'video-failed', paused: true },
    ],
    [
      'an event that says it was not paused: no key',
      { ...stamp, type: 'video-failed', paused: false },
      null,
    ],
    [
      'what a newer page adds: dropped',
      { ...stamp, type: 'video-failed', mood: 'calm' },
      { ...stamp, type: 'video-failed' },
    ],
  ])('reads %s', (_label, input, expected) => {
    expect(parseMeetingEvent(input)).toEqual(expected);
  });

  it.each([
    ['a type it does not know', { ...stamp, type: 'hand-raised' }],
    [
      'a stop for a reason it does not know',
      { ...stamp, type: 'recording-stopped', reason: 'meteor' },
    ],
    ['restarts given up without their count', { ...stamp, type: 'restarts-exhausted' }],
    ['a resume without how long it was paused', { ...stamp, type: 'recording-resumed' }],
    [
      'a restore without how long it was lost',
      { ...stamp, type: 'connection-restored', lostMs: -1 },
    ],
    ['a negative position', { ...stamp, mediaMs: -1, type: 'video-failed' }],
    ['no stamp', { type: 'video-failed' }],
    ['nothing', undefined],
  ])('refuses %s', (_label, input) => {
    expect(parseMeetingEvent(input)).toBeNull();
  });
});
