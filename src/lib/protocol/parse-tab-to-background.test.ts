import { describe, expect, it } from 'vitest';
import type { TabSnapshot } from '@/lib/types';
import { parseTabToBackground } from './parse-tab-to-background';

const snapshot: TabSnapshot = {
  state: 'idle',
  provider: 'meet',
  meetingCode: null,
  title: 't',
  recordingId: null,
  recordingStartedAt: null,
  remoteTracks: 0,
  micLabel: null,
  connected: false,
  admitted: false,
};
const id = '4f3c6d2a-9d7c-4a4e-9f1e-0c1b2a3d4e5f';

describe('parseTabToBackground', () => {
  it.each([
    ['hello', { type: 'hello', snapshot }],
    ['snapshot', { type: 'snapshot', snapshot }],
    [
      'recordingStarted',
      {
        type: 'recordingStarted',
        info: {
          recordingId: id,
          provider: 'meet',
          meetingCode: 'c',
          title: 't',
          startedAt: 1,
          mimeType: 'm',
          micLabel: null,
        },
      },
    ],
    [
      'chunk',
      { type: 'chunk', chunk: { recordingId: id, seq: 0, blob: new Blob(['x']), timestampMs: 0 } },
    ],
    [
      'recordingEnded',
      {
        type: 'recordingEnded',
        info: { recordingId: id, chunkCount: 1, durationMs: 3, reason: 'pagehide' },
      },
    ],
    ['log', { type: 'log', log: { level: 'warn', message: 'careful' } }],
    [
      'a numbered log line with the time the bridge got it',
      {
        type: 'log',
        log: { level: 'warn', message: 'careful' },
        at: 1_000,
        receipt: { bridge: 'b1', seq: 3 },
      },
    ],
    ['ping', { type: 'ping' }],
  ])('accepts %s', (_label, message) => {
    expect(parseTabToBackground(message)).toEqual(message);
  });

  it.each([
    ['an unknown type', { type: 'nope' }],
    ['a hello without snapshot', { type: 'hello' }],
    ['a bad snapshot', { type: 'snapshot', snapshot: { state: 'x' } }],
    ['a bad recordingStarted', { type: 'recordingStarted', info: {} }],
    ['a bad chunk', { type: 'chunk', chunk: { seq: 0 } }],
    ['a bad recordingEnded', { type: 'recordingEnded', info: { reason: 'x' } }],
    ['a bad log', { type: 'log', log: { level: 'loud', message: 'x' } }],
    ['a non-object', 'ping'],
    ['a missing type', {}],
  ])('rejects %s', (_label, message) => {
    expect(parseTabToBackground(message)).toBeNull();
  });

  it('keeps a log line whose number or time is malformed, without them', () => {
    const log = { level: 'info', message: 'x' };
    expect(parseTabToBackground({ type: 'log', log, at: 'soon', receipt: { seq: -1 } })).toEqual({
      type: 'log',
      log,
    });
  });
});

describe('parseTabToBackground, meeting events', () => {
  const event = { seq: 0, atMs: 1, mediaMs: 0, type: 'recording-started' };

  it('reads a batch of meeting events', () => {
    const batch = { recordingId: id, events: [event], droppedRanges: [] };
    expect(parseTabToBackground({ type: 'events', batch })).toEqual({ type: 'events', batch });
  });

  it('rejects a batch it cannot read', () => {
    expect(parseTabToBackground({ type: 'events', batch: { recordingId: id } })).toBeNull();
  });

  // The bridge forwards no such batch: it answers the page itself.
  it('rejects a batch with no event it knows', () => {
    const batch = {
      recordingId: id,
      events: [{ ...event, type: 'hand-raised' }],
      droppedRanges: [],
    };
    expect(parseTabToBackground({ type: 'events', batch })).toBeNull();
  });
});
