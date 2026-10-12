import { describe, expect, it } from 'vitest';
import type { MeetingEvent } from '@/lib/types';
import { startEvent } from '@/test/notes/start-event';
import { isDroppableMeetingEvent } from './is-droppable-meeting-event';

const stamp = { seq: 0, atMs: 1, mediaMs: 0 };
const roster = (why: 'start' | 'reannounce' | 'stop'): MeetingEvent => ({
  ...stamp,
  type: 'roster',
  why,
  source: 'stage',
  participants: [],
  count: 2,
  share: 'none',
  shareBy: null,
  stale: false,
  readAtMs: 1,
  capabilities: null,
});
const ana = { id: 'p2', name: 'Ana', self: false, identity: 'service-id' } as const;

describe('isDroppableMeetingEvent', () => {
  // They frame the timeline and say why a file ends where it does: a full queue never drops them.
  it.each<[string, MeetingEvent]>([
    ['a start', startEvent(stamp)],
    ['a stop', { ...stamp, type: 'recording-stopped', reason: 'command' }],
    ['a pause', { ...stamp, type: 'recording-paused' }],
    ['a resume', { ...stamp, type: 'recording-resumed', pausedMs: 4_000 }],
    ['the video failing', { ...stamp, type: 'video-failed' }],
    ['the restarts given up', { ...stamp, type: 'restarts-exhausted', failures: 4 }],
    // Who was there at the start and at the end: everything about people is read from them.
    ['the reading of the call at the start', roster('start')],
    ['the reading of the call at the stop', roster('stop')],
  ])('never lets a full queue drop %s', (_label, event) => {
    expect(isDroppableMeetingEvent(event)).toBe(false);
  });

  // What the page saw of the call, as against what happened to the recording.
  it.each<[string, MeetingEvent]>([
    ['a lost connection', { ...stamp, type: 'connection-lost' }],
    ['a restored connection', { ...stamp, type: 'connection-restored', lostMs: 3_000 }],
    ['an extension reload', { ...stamp, type: 'extension-reloaded' }],
    ['a reading of the call said again', roster('reannounce')],
    ['a join', { ...stamp, type: 'participant-joined', participant: ana, count: 3 }],
    ['a count', { ...stamp, type: 'participant-count', count: 3 }],
  ])('lets a full queue drop %s', (_label, event) => {
    expect(isDroppableMeetingEvent(event)).toBe(true);
  });
});
