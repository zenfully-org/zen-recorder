/**
 * The page's meeting events, for the meeting notes: it numbers each recording's events from 0 in
 * the order it sees them, stamps each with the wall time and the recording's place in its file
 * (`Encoder.mediaTimeMs()` in whole milliseconds, the pause position while paused), and hands them
 * to the recording's own
 * event sender, which goes on delivering after the recording stopped.
 *
 * It sends only to a bridge that speaks the events protocol (`configure`), and the stop never waits
 * long for it: `whenSettled` waits at most the time it is given, or until the page goes away
 * (`settleNow`), then says how many events the bridge acked, how many the page dropped below that,
 * and how many it has not acked yet.
 */
import { createEventSender, type EventSender } from '@/lib/page/create-event-sender';
import type { MeetingEvent, MeetingEventBatch, StopReason } from '@/lib/types';

/** The recording an event belongs to, as far as stamping it goes (`state` is its encoder's). */
interface TrackedRecording {
  id: string;
  encoder: { mediaTimeMs(): number; state(): RecordingState };
}

/** The end's counts of a recording's events. */
interface EventCounts {
  eventCount: number;
  eventsDropped: number;
  eventsUnsent: number;
}

export interface NotesTracker {
  /** The events protocol the bridge speaks, from its configure: 0 sends nothing. */
  configure(eventsProtocol: number): void;
  recordingStarted(recording: TrackedRecording): void;
  /** Stamped before the encoder stops, so its place is the end of the file. */
  recordingStopped(recording: TrackedRecording, reason: StopReason): void;
  /**
   * Calls `done` once with the counts of the recording's events: once every one is acked, after
   * `maxWaitMs`, or on `settleNow`, whichever comes first.
   */
  whenSettled(recordingId: string, maxWaitMs: number, done: (counts: EventCounts) => void): void;
  /** Settles every wait now, in this task: for a page that goes away, which runs no later one. */
  settleNow(): void;
  /** The newest recording's events, for the page's debug view. */
  debug(): { protocol: number; lastSeq: number; pending: number; acked: number };
}

export interface NotesTrackerDeps {
  send(batch: MeetingEventBatch): Promise<unknown>;
  /** Which events a full queue may drop; by default every one but the start and the stop. */
  isDroppable?: (event: MeetingEvent) => boolean;
  now(): number;
  setTimeout: (handler: () => void, ms: number) => unknown;
  clearTimeout?: (id: unknown) => void;
}

interface Tracked {
  sender: EventSender;
  nextSeq: number;
}

/** A recording's events as they stand: acked, dropped below that, and not acked yet. */
function countsOf(tracked: Tracked | undefined): EventCounts {
  if (!tracked) return { eventCount: 0, eventsDropped: 0, eventsUnsent: 0 };
  const eventCount = tracked.sender.lastAckedSeq() + 1;
  return {
    eventCount,
    eventsDropped: tracked.sender.dropped().filter((seq) => seq < eventCount).length,
    eventsUnsent: tracked.nextSeq - eventCount,
  };
}

/** The lifecycle events are the timeline's frame: the queue never drops them. */
const LIFECYCLE = new Set<MeetingEvent['type']>(['recording-started', 'recording-stopped']);

export function createNotesTracker(deps: NotesTrackerDeps): NotesTracker {
  const isDroppable = deps.isDroppable ?? ((event: MeetingEvent) => !LIFECYCLE.has(event.type));
  const recordings = new Map<string, Tracked>();
  let newest: Tracked | null = null;
  let protocol = 0;
  const waiting = new Set<() => void>();

  const track = (recordingId: string): Tracked => {
    const tracked = {
      sender: createEventSender({
        recordingId,
        send: deps.send,
        isDroppable,
        setTimeout: deps.setTimeout,
        ...(deps.clearTimeout ? { clearTimeout: deps.clearTimeout } : {}),
      }),
      nextSeq: 0,
    };
    tracked.sender.setEnabled(protocol >= 1);
    recordings.set(recordingId, tracked);
    newest = tracked;
    return tracked;
  };

  /** Numbers and stamps `event` for `recording`, and queues it. */
  const record = (
    recording: TrackedRecording,
    event: { type: 'recording-started' } | { type: 'recording-stopped'; reason: StopReason },
  ): void => {
    const tracked = recordings.get(recording.id) ?? track(recording.id);
    const paused = recording.encoder.state() === 'paused';
    tracked.sender.enqueue({
      ...event,
      seq: tracked.nextSeq++,
      atMs: deps.now(),
      mediaMs: Math.round(recording.encoder.mediaTimeMs()),
      ...(paused ? { paused: true } : {}),
    });
  };

  return {
    configure(eventsProtocol) {
      protocol = eventsProtocol;
      for (const { sender } of recordings.values()) sender.setEnabled(protocol >= 1);
    },
    recordingStarted: (recording) => record(recording, { type: 'recording-started' }),
    recordingStopped: (recording, reason) =>
      record(recording, { type: 'recording-stopped', reason }),
    whenSettled(recordingId, maxWaitMs, done) {
      const tracked = recordings.get(recordingId);
      // Done first, then forgotten: a page stopped between the two settles it again, harmlessly.
      const settle = (): void => {
        if (!waiting.has(settle)) return;
        done(countsOf(tracked));
        waiting.delete(settle);
      };
      waiting.add(settle);
      deps.setTimeout(settle, maxWaitMs);
      void (tracked?.sender.whenIdle() ?? Promise.resolve()).then(settle);
    },
    settleNow() {
      for (const settle of waiting) settle();
    },
    debug: () => ({
      protocol,
      lastSeq: (newest?.nextSeq ?? 0) - 1,
      pending: newest?.sender.pending() ?? 0,
      acked: newest?.sender.lastAckedSeq() ?? -1,
    }),
  };
}
