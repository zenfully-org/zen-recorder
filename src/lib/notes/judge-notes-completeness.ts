import type { MeetingNotesDocument } from '@/lib/notes/parse-meeting-notes';

type Capture = MeetingNotesDocument['capture'];

/** What the page and the background counted of a recording's events. */
export interface EventCounts {
  /** 0: the page session is older than the notes and sent none. */
  eventsProtocol: number;
  /** The page collected nothing: notes were off while it recorded. */
  notesOffWhileRecording: boolean;
  /** Saved after an unexpected end: the page never sent its end and its counts. */
  recovered: boolean;
  /** Events the page had sent and the background acked when the recording ended. */
  eventCount?: number | undefined;
  /** Events the page still held when the recording ended, sent after it. */
  eventsUnsent?: number | undefined;
  /** Events the page dropped when too many came at once. */
  eventsDropped?: number | undefined;
  /** Events the background did not store, past its cap per recording. */
  eventsCapped?: number | undefined;
}

/** Why the page sent no event, or none that could make a complete timeline; null otherwise. */
const withoutEvents = (
  counts: EventCounts,
): Pick<Capture, 'events' | 'eventsMissingReason'> | null => {
  if (counts.eventsProtocol === 0)
    return { events: 'none', eventsMissingReason: 'page-session-too-old' };
  if (counts.notesOffWhileRecording) {
    return { events: 'none', eventsMissingReason: 'notes-off-during-recording' };
  }
  if (counts.recovered) return { events: 'incomplete', eventsMissingReason: 'recovered' };
  return null;
};

/** The seqs the page numbered that are not stored, and how many it sent before the end. */
const missingSeqs = (counts: EventCounts, storedSeqs: readonly number[]) => {
  const stored = new Set(storedSeqs);
  const sent = counts.eventCount ?? Math.max(-1, ...storedSeqs) + 1;
  const assigned = sent + (counts.eventsUnsent ?? 0);
  const missing = Array.from({ length: assigned }, (_, seq) => seq).filter(
    (seq) => !stored.has(seq),
  );
  return { sent, missing };
};

/**
 * Whether the stored events are the whole timeline, and if not why, the first reason that
 * applies: the page sent none (too old, or notes off), the recording was recovered, events never
 * came after the end, the page dropped exactly the missing ones, or the counts do not match.
 * Complete when every seq the page assigned (`0` to `eventCount + eventsUnsent - 1`) is stored,
 * late arrivals included.
 */
export function judgeNotesCompleteness(
  counts: EventCounts,
  storedSeqs: readonly number[],
): Pick<Capture, 'events' | 'eventsMissingReason'> {
  const early = withoutEvents(counts);
  if (early) return early;
  const { sent, missing } = missingSeqs(counts, storedSeqs);
  if (missing.length === 0) return { events: 'complete', eventsMissingReason: null };
  if (missing.some((seq) => seq >= sent)) {
    return { events: 'incomplete', eventsMissingReason: 'events-unsent' };
  }
  const dropped = (counts.eventsDropped ?? 0) + (counts.eventsCapped ?? 0);
  return {
    events: 'incomplete',
    eventsMissingReason: missing.length === dropped ? 'events-dropped' : 'count-mismatch',
  };
}
