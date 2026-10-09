import { describe, expect, it } from 'vitest';
import { isDroppableMeetingEvent } from './is-droppable-meeting-event';

describe('isDroppableMeetingEvent', () => {
  // The start and the stop frame the timeline: a full queue never drops them.
  it('never lets a full queue drop a recording start or stop', () => {
    const stamp = { seq: 0, atMs: 1, mediaMs: 0 };
    expect(isDroppableMeetingEvent({ ...stamp, type: 'recording-started' })).toBe(false);
    expect(
      isDroppableMeetingEvent({ ...stamp, type: 'recording-stopped', reason: 'command' }),
    ).toBe(false);
  });
});
