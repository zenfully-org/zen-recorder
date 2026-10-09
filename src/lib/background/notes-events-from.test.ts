import { describe, expect, it } from 'vitest';
import type { MeetingEvent } from '@/lib/types';
import { notesEventsFrom } from './notes-events-from';

const started: MeetingEvent = { seq: 0, atMs: 1_000, mediaMs: 0, type: 'recording-started' };
const stopped: MeetingEvent = {
  seq: 1,
  atMs: 61_000,
  mediaMs: 59_800,
  paused: true,
  type: 'recording-stopped',
  reason: 'left-meeting',
};

describe('notesEventsFrom', () => {
  // What the page does not report yet stays unknown (null): the notes say it was not observed.
  it("gives the notes a recording's start and stop, the start with what is known of it", () => {
    expect(notesEventsFrom([started, stopped], 'video')).toEqual([
      {
        seq: 0,
        atMs: 1_000,
        mediaMs: 0,
        type: 'recording-started',
        cause: null,
        media: 'video',
        audioOnlyReason: null,
        continuesRecordingId: null,
        gapMs: null,
        mic: null,
        tabVisible: null,
        ownShare: null,
      },
      {
        seq: 1,
        atMs: 61_000,
        mediaMs: 59_800,
        paused: true,
        type: 'recording-stopped',
        reason: 'left-meeting',
      },
    ]);
  });
});
