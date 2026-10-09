import { describe, expect, it } from 'vitest';
import { recordingEndPatch } from './recording-end-patch';

const END = { recordingId: 'r', chunkCount: 3, durationMs: 9_000, reason: 'left-meeting' } as const;

describe('recordingEndPatch', () => {
  it('stores when and why a recording ended, and how long it is', () => {
    expect(recordingEndPatch(END, 777)).toEqual({
      status: 'ended',
      endedAt: 777,
      durationMs: 9_000,
      endReason: 'left-meeting',
    });
  });

  it('stores the counts of its meeting events that the end carries', () => {
    const counts = { eventCount: 4, eventsDropped: 1, eventsUnsent: 2 };
    expect(recordingEndPatch({ ...END, ...counts }, 777)).toMatchObject(counts);
    expect(recordingEndPatch({ ...END, eventCount: 0 }, 777)).not.toHaveProperty('eventsUnsent');
  });
});
