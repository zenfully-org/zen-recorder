import { describe, expect, it } from 'vitest';
import type { MeetingEvent } from '@/lib/types';
import { startEvent } from '@/test/notes/start-event';
import { isDroppableMeetingEvent } from './is-droppable-meeting-event';

const stamp = { seq: 0, atMs: 1, mediaMs: 0 };

describe('isDroppableMeetingEvent', () => {
  // They frame the timeline and say why a file ends where it does: a full queue never drops them.
  it.each<[string, MeetingEvent]>([
    ['a start', startEvent(stamp)],
    ['a stop', { ...stamp, type: 'recording-stopped', reason: 'command' }],
    ['the video failing', { ...stamp, type: 'video-failed' }],
    ['the restarts given up', { ...stamp, type: 'restarts-exhausted', failures: 4 }],
  ])('never lets a full queue drop %s', (_label, event) => {
    expect(isDroppableMeetingEvent(event)).toBe(false);
  });
});
