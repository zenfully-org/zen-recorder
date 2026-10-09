import { describe, expect, it } from 'vitest';
import { type EventCounts, judgeNotesCompleteness } from './judge-notes-completeness';

const counts = (patch: Partial<EventCounts> = {}): EventCounts => ({
  eventsProtocol: 1,
  notesOffWhileRecording: false,
  recovered: false,
  eventCount: 4,
  eventsUnsent: 0,
  eventsDropped: 0,
  eventsCapped: 0,
  ...patch,
});

describe('judgeNotesCompleteness', () => {
  it.each<[string, Partial<EventCounts>, number[], string, string | null]>([
    ['every seq stored', {}, [0, 1, 2, 3], 'complete', null],
    [
      'events sent after the end, which arrived',
      { eventCount: 2, eventsUnsent: 2 },
      [0, 1, 2, 3],
      'complete',
      null,
    ],
    ['an older page session', { eventsProtocol: 0 }, [], 'none', 'page-session-too-old'],
    [
      'notes off while recording',
      { notesOffWhileRecording: true },
      [],
      'none',
      'notes-off-during-recording',
    ],
    // The first reason that applies: a recovered recording never sent its end.
    [
      'a recovered recording',
      { recovered: true, eventsProtocol: 1 },
      [0, 1, 2, 3],
      'incomplete',
      'recovered',
    ],
    [
      'events sent after the end, which never arrived',
      { eventCount: 2, eventsUnsent: 2 },
      [0, 1],
      'incomplete',
      'events-unsent',
    ],
    [
      'the events the page dropped',
      { eventsDropped: 1 },
      [0, 2, 3],
      'incomplete',
      'events-dropped',
    ],
    [
      'the events the background did not store',
      { eventsCapped: 2 },
      [0, 3],
      'incomplete',
      'events-dropped',
    ],
    [
      'events missing for another reason',
      { eventsDropped: 1 },
      [0, 3],
      'incomplete',
      'count-mismatch',
    ],
  ])('%s', (_label, patch, seqs, events, reason) => {
    expect(judgeNotesCompleteness(counts(patch), seqs)).toEqual({
      events,
      eventsMissingReason: reason,
    });
  });

  // An end that carried no counts: the stored seqs are all there is to go by.
  it('judges by the stored seqs when the end carried no counts', () => {
    const none = counts({
      eventCount: undefined,
      eventsUnsent: undefined,
      eventsDropped: undefined,
      eventsCapped: undefined,
    });
    expect(judgeNotesCompleteness(none, [0, 1, 2])).toEqual({
      events: 'complete',
      eventsMissingReason: null,
    });
    expect(judgeNotesCompleteness(none, [0, 2])).toEqual({
      events: 'incomplete',
      eventsMissingReason: 'count-mismatch',
    });
    expect(judgeNotesCompleteness(none, [])).toEqual({
      events: 'complete',
      eventsMissingReason: null,
    });
  });
});
