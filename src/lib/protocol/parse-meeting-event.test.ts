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

const ana = { id: 'p2', name: 'Ana', self: false, identity: 'service-id' };
const user = { id: 'p1', name: null, self: true, identity: 'service-id' };
const roster = {
  type: 'roster',
  why: 'start',
  source: 'stage',
  participants: [user, ana],
  count: 2,
  share: 'active',
  shareBy: ana,
  stale: false,
  readAtMs: 1_700_000_000_000,
  capabilities: { count: true, roster: false, self: true, share: true, shareBy: true },
};

/** What the parser reads: an event as sent or stored, and the event it gives. */
const READ: [string, unknown, unknown][] = [
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
    'a microphone',
    { ...stamp, type: 'mic', state: 'muted' },
    { ...stamp, type: 'mic', state: 'muted' },
  ],
  [
    'a title',
    { ...stamp, type: 'title-changed', title: 'Weekly sync' },
    { ...stamp, type: 'title-changed', title: 'Weekly sync' },
  ],
  [
    'a hidden tab',
    { ...stamp, type: 'coverage-lost', signal: 'participants', reason: 'tab-hidden' },
    { ...stamp, type: 'coverage-lost', signal: 'participants', reason: 'tab-hidden' },
  ],
  [
    'a tab visible again',
    { ...stamp, type: 'coverage-restored', signal: 'participants', reason: 'tab-hidden' },
    { ...stamp, type: 'coverage-restored', signal: 'participants', reason: 'tab-hidden' },
  ],
  [
    'an extension reload',
    { ...stamp, type: 'extension-reloaded' },
    { ...stamp, type: 'extension-reloaded' },
  ],
  ['a reading of the call', { ...stamp, ...roster }, { ...stamp, ...roster }],
  [
    'a reading with nothing known but the user',
    {
      ...stamp,
      ...roster,
      why: 'stop',
      source: null,
      participants: [user],
      count: null,
      share: 'unknown',
      shareBy: null,
      stale: true,
      capabilities: null,
    },
    {
      ...stamp,
      ...roster,
      why: 'stop',
      source: null,
      participants: [user],
      count: null,
      share: 'unknown',
      shareBy: null,
      stale: true,
      capabilities: null,
    },
  ],
  [
    'a join',
    { ...stamp, type: 'participant-joined', participant: ana, count: 3 },
    { ...stamp, type: 'participant-joined', participant: ana, count: 3 },
  ],
  [
    'a leave of nobody named, without a count',
    { ...stamp, type: 'participant-left', participant: null, count: null },
    { ...stamp, type: 'participant-left', participant: null, count: null },
  ],
  [
    'a rename',
    { ...stamp, type: 'participant-renamed', participant: ana, from: 'Ana S.' },
    { ...stamp, type: 'participant-renamed', participant: ana, from: 'Ana S.' },
  ],
  [
    'a count',
    { ...stamp, type: 'participant-count', count: 5 },
    { ...stamp, type: 'participant-count', count: 5 },
  ],
  [
    'a share',
    { ...stamp, type: 'share-started', by: ana },
    { ...stamp, type: 'share-started', by: ana },
  ],
  [
    'the end of a share by nobody named',
    { ...stamp, type: 'share-stopped', by: null },
    { ...stamp, type: 'share-stopped', by: null },
  ],
  [
    'shares off screen',
    { ...stamp, type: 'coverage-lost', signal: 'share', reason: 'presence-unavailable' },
    { ...stamp, type: 'coverage-lost', signal: 'share', reason: 'presence-unavailable' },
  ],
  [
    'the call off screen',
    {
      ...stamp,
      type: 'coverage-lost',
      signal: 'participants',
      reason: 'presence-unavailable',
    },
    {
      ...stamp,
      type: 'coverage-lost',
      signal: 'participants',
      reason: 'presence-unavailable',
    },
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
];

/** What it refuses. */
const REFUSED: [string, unknown][] = [
  ['a type it does not know', { ...stamp, type: 'hand-raised' }],
  [
    'a stop for a reason it does not know',
    { ...stamp, type: 'recording-stopped', reason: 'meteor' },
  ],
  ['restarts given up without their count', { ...stamp, type: 'restarts-exhausted' }],
  ['a resume without how long it was paused', { ...stamp, type: 'recording-resumed' }],
  ['a microphone in a state it does not know', { ...stamp, type: 'mic', state: 'loud' }],
  ['a title that is not text', { ...stamp, type: 'title-changed', title: 7 }],
  [
    'coverage for a reason it does not know',
    { ...stamp, type: 'coverage-lost', signal: 'participants', reason: 'eclipse' },
  ],
  ['a restore without how long it was lost', { ...stamp, type: 'connection-restored', lostMs: -1 }],
  ['a negative position', { ...stamp, mediaMs: -1, type: 'video-failed' }],
  // The notes name people by their own ids only: a service's id is never stored.
  [
    'a participant named by a service id',
    {
      ...stamp,
      type: 'participant-joined',
      participant: { ...ana, id: 'spaces/x/devices/7' },
      count: 2,
    },
  ],
  [
    'a reading of the call with a participant it cannot read',
    { ...stamp, ...roster, participants: [user, { ...ana, self: 'maybe' }] },
  ],
  ['a count of nobody', { ...stamp, type: 'participant-count', count: 0 }],
  ['a share without who shares', { ...stamp, type: 'share-started' }],
  ['a rename without the person', { ...stamp, type: 'participant-renamed', from: 'Ana' }],
  ['no stamp', { type: 'video-failed' }],
  ['nothing', undefined],
];

describe('parseMeetingEvent', () => {
  it.each(READ)('reads %s', (_label, input, expected) => {
    expect(parseMeetingEvent(input)).toEqual(expected);
  });

  it.each(REFUSED)('refuses %s', (_label, input) => {
    expect(parseMeetingEvent(input)).toBeNull();
  });
});
