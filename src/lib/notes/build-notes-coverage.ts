import type { MeetingNotesDocument, NotesEvent } from '@/lib/notes/parse-meeting-notes';

type Coverage = MeetingNotesDocument['capture']['coverage'][number];
type Point = Pick<NotesEvent, 'at' | 'mediaMs'>;

const span = (signal: string, reason: string, from: Point, to: Point): Coverage => ({
  signal,
  reason,
  fromMs: from.mediaMs,
  toMs: to.mediaMs,
  fromAt: from.at,
  toAt: to.at,
});

/** A pause, from its start to the resume after it, or to the end. Not in the file: one point. */
const pauses = (events: readonly NotesEvent[], end: Point): Coverage[] =>
  events.flatMap((event, index) => {
    if (event.type !== 'recording-paused') return [];
    const resumed = events.slice(index + 1).find((later) => later.type === 'recording-resumed');
    return [span('all', 'paused', event, { at: resumed?.at ?? end.at, mediaMs: event.mediaMs })];
  });

/** Where events went missing: from the last one before each gap in the seqs to the first after. */
const gaps = (events: readonly NotesEvent[]): Coverage[] =>
  events.flatMap((event, index) => {
    const before = events[index - 1];
    return before !== undefined && event.seq > before.seq + 1
      ? [span('all', 'events-dropped', before, event)]
      : [];
  });

/** A signal the page could not observe, from its loss to its return, or to the end. */
const losses = (events: readonly NotesEvent[], end: Point): Coverage[] =>
  events.flatMap((event, index) => {
    if (event.type !== 'coverage-lost') return [];
    const restored = events
      .slice(index + 1)
      .find(
        (later) =>
          later.type === 'coverage-restored' &&
          later.signal === event.signal &&
          later.reason === event.reason,
      );
    return [span(event.signal, event.reason, event, restored ?? end)];
  });

/**
 * The spans of the file where a signal was not reliably observed: pauses, events the page dropped
 * (gaps in the seqs), and every span the page said it could not see (a hidden tab, a call off
 * screen). `end` closes a span the recording ended in.
 */
export function buildNotesCoverage(events: readonly NotesEvent[], end: Point): Coverage[] {
  return [...pauses(events, end), ...gaps(events), ...losses(events, end)];
}
