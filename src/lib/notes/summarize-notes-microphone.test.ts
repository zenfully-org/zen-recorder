import { describe, expect, it } from 'vitest';
import type { MeetingNotesDocument, NotesEvent } from '@/lib/notes/parse-meeting-notes';
import { EXAMPLE_NOTES } from '@/test/notes/example-notes-document';
import { summarizeNotesMicrophone } from './summarize-notes-microphone';

type Mic = 'live' | 'muted' | 'not-connected';
const start = (mic: Mic | null): NotesEvent => ({
  seq: 0,
  type: 'recording-started',
  at: '2026-10-04T14:03:05+02:00',
  mediaMs: 0,
  source: 'page',
  cause: 'manual',
  media: 'audio',
  audioOnlyReason: null,
  continuesRecordingId: null,
  gapMs: null,
  mic,
  tabVisible: true,
  ownShare: false,
});
const mic = (seq: number, mediaMs: number, state: Mic): NotesEvent => ({
  seq,
  type: 'mic',
  at: '2026-10-04T14:10:00+02:00',
  mediaMs,
  source: 'page',
  state,
});
const notes = (
  events: NotesEvent[],
  durationMs: number | null = 600_000,
): MeetingNotesDocument => ({
  ...EXAMPLE_NOTES,
  recording: { ...EXAMPLE_NOTES.recording, durationMs },
  events,
});

describe('summarizeNotesMicrophone', () => {
  it('says the microphone was not observed when the service cannot show it', () => {
    const document = notes([start('live')]);
    const blind = {
      ...document,
      capture: {
        ...document.capture,
        signals: { ...document.capture.signals, mic: 'not-available' as const },
      },
    };
    expect(summarizeNotesMicrophone(blind)).toBe('not observed');
  });

  it('says it was not observed when nothing about it was read', () => {
    expect(summarizeNotesMicrophone(notes([start(null)]))).toBe('not observed');
  });

  it('says it stayed on', () => {
    expect(summarizeNotesMicrophone(notes([start('live')]))).toBe('on for the whole recording');
  });

  it('counts a microphone muted from the start, up to the end of the file', () => {
    expect(summarizeNotesMicrophone(notes([start('muted')]))).toBe('muted once, 0:10:00 in total');
  });

  it('adds up every muted span and every span without a microphone', () => {
    const events = [
      start('live'),
      mic(1, 60_000, 'muted'),
      mic(2, 90_000, 'live'),
      mic(3, 120_000, 'not-connected'),
      mic(4, 125_000, 'live'),
      mic(5, 300_000, 'muted'),
    ];
    expect(summarizeNotesMicrophone(notes(events))).toBe(
      'muted twice, 0:05:30 in total; not connected once, 0:00:05 in total',
    );
  });

  it('ends the last span at the last event when the file has no known length', () => {
    const events = [start(null), mic(1, 60_000, 'muted'), mic(2, 200_000, 'muted')];
    expect(summarizeNotesMicrophone(notes(events, null))).toBe('muted twice, 0:02:20 in total');
  });
});
