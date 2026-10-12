import { describe, expect, it } from 'vitest';
import type { MeetingEvent } from '@/lib/types';
import { startEvent } from '@/test/notes/start-event';
import { notesEventsFrom } from './notes-events-from';

const started: MeetingEvent = startEvent({ seq: 0, atMs: 1_000, mediaMs: 0 });
const stopped: MeetingEvent = {
  seq: 1,
  atMs: 61_000,
  mediaMs: 59_800,
  paused: true,
  type: 'recording-stopped',
  reason: 'left-meeting',
};

describe('notesEventsFrom', () => {
  it('gives the notes what a start says, and the media of the file when it says none', () => {
    const restarted = startEvent(
      { seq: 0, atMs: 1_000, mediaMs: 0 },
      { cause: 'restart-after-video-failure', media: 'audio', audioOnlyReason: 'video-failed' },
    );
    expect(notesEventsFrom([restarted], 'video')).toEqual([restarted]);
  });

  // A page of the first notes release said nothing else of its start: not known (null).
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
