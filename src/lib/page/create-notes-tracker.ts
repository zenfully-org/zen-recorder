/**
 * The page's meeting events, for the meeting notes: it numbers each recording's events from 0 in
 * the order it sees them, stamps each with the wall time and the recording's place in its file
 * (`Encoder.mediaTimeMs()` in whole milliseconds, the pause position while paused), and hands them
 * to the recording's own event sender, which goes on delivering after the recording stopped. A
 * recording started while the notes are off gets no events at all, and each recording one start and
 * one stop, with nothing after its stop: a page that goes away hands its recording over twice when
 * Firefox cut the first short.
 *
 * A start says why the recording started, what it records, and which recording it goes on from:
 * the previous one of the page in the same meeting, whatever ended it, with the wall time between
 * the two. A meeting split into files reads as one that way.
 *
 * It sends only to a bridge that speaks the events protocol (`configure`), and the stop never waits
 * long for it: `whenSettled` waits at most the time it is given, or until the page goes away
 * (`settleNow`), then says how many events the bridge acked, how many the page dropped below that,
 * and how many it has not acked yet. `counts` says it at once, for an end that cannot wait.
 */
import { countMeetingEvents, type MeetingEventCounts } from '@/lib/page/count-meeting-events';
import { createEventSender, type EventSender } from '@/lib/page/create-event-sender';
import { createStartFacts, type NotesStart, type StartFacts } from '@/lib/page/create-start-facts';
import { isDroppableMeetingEvent } from '@/lib/page/is-droppable-meeting-event';
import type {
  MeetingEventBatch,
  MeetingEventBody,
  MeetingNotesMode,
  StopReason,
} from '@/lib/types';

/**
 * The recording an event belongs to, as far as stamping it goes (`state` is its encoder's), and
 * its video pipeline, null without video.
 */
interface TrackedRecording {
  id: string;
  encoder: { mediaTimeMs(): number; state(): RecordingState };
  video: object | null;
}

/** An event of a running recording, between its start and its stop. */
type RecordingEvent = Exclude<
  MeetingEventBody,
  { type: 'recording-started' } | { type: 'recording-stopped' }
>;

export interface NotesTracker {
  /**
   * The events protocol the bridge speaks (0 sends nothing) and the notes setting, from its
   * configure. A recording started while the notes are `off` gets no events.
   */
  configure(config: { eventsProtocol: number; meetingNotes: MeetingNotesMode }): void;
  /**
   * Once per recording; a second start is ignored. Gives what its announcement says of it: why it
   * started, why without video, and what it continues. Said with the notes off too: the notes
   * setting can be turned on before the recording is saved.
   */
  recordingStarted(recording: TrackedRecording, start: NotesStart): StartFacts;
  /** Stamps `event` of a recording it tracks; nothing once its stop is stamped. */
  record(recording: TrackedRecording | null, event: RecordingEvent): void;
  /** Stamped before the encoder stops, so its place is the end of the file; once per recording. */
  recordingStopped(recording: TrackedRecording, reason: StopReason): void;
  /** The recording's events as they stand now. */
  counts(recordingId: string): MeetingEventCounts;
  /**
   * Calls `done` once with the counts of the recording's events: once every one is acked, after
   * `maxWaitMs`, or on `settleNow`, whichever comes first.
   */
  whenSettled(
    recordingId: string,
    maxWaitMs: number,
    done: (counts: MeetingEventCounts) => void,
  ): void;
  /** Settles every wait now, in this task: for a page that goes away, which runs no later one. */
  settleNow(): void;
  /** The newest recording's events, for the page's debug view. */
  debug(): { protocol: number; lastSeq: number; pending: number; acked: number };
}

export interface NotesTrackerDeps {
  send(batch: MeetingEventBatch): Promise<unknown>;
  now(): number;
  setTimeout: (handler: () => void, ms: number) => unknown;
  clearTimeout?: (id: unknown) => void;
}

interface Tracked {
  sender: EventSender;
  nextSeq: number;
  stopped: boolean;
}

/** A recording's events as they stand: acked, dropped below that, and not acked yet. */
const countsOf = (tracked: Tracked | undefined): MeetingEventCounts =>
  countMeetingEvents({
    lastAckedSeq: tracked?.sender.lastAckedSeq() ?? -1,
    dropped: tracked?.sender.dropped() ?? [],
    nextSeq: tracked?.nextSeq ?? 0,
  });

/**
 * Numbers and stamps `event` of `recording` seen at `atMs`, and queues it. The number is taken only
 * once the event is queued: a call stopped short before that leaves the next call to stamp it again.
 */
function stamp(
  tracked: Tracked,
  recording: TrackedRecording,
  event: MeetingEventBody,
  atMs: number,
): void {
  const paused = recording.encoder.state() === 'paused';
  const seq = tracked.nextSeq;
  tracked.sender.enqueue({
    ...event,
    seq,
    atMs,
    mediaMs: Math.round(recording.encoder.mediaTimeMs()),
    ...(paused ? { paused: true } : {}),
  });
  tracked.nextSeq = seq + 1;
}

/** The states at the start, which no page reads yet: not known. */
const STATES_AT_START = { mic: null, tabVisible: null, ownShare: null } as const;

export function createNotesTracker(deps: NotesTrackerDeps): NotesTracker {
  const recordings = new Map<string, Tracked>();
  let newest: Tracked | null = null;
  let protocol = 0;
  let mode: MeetingNotesMode = 'withNames';
  const starts = createStartFacts();
  const waiting = new Set<() => void>();

  const track = (recordingId: string): Tracked => {
    const tracked = {
      sender: createEventSender({
        recordingId,
        send: deps.send,
        isDroppable: isDroppableMeetingEvent,
        setTimeout: deps.setTimeout,
        ...(deps.clearTimeout ? { clearTimeout: deps.clearTimeout } : {}),
      }),
      nextSeq: 0,
      stopped: false,
    };
    tracked.sender.setEnabled(protocol >= 1);
    recordings.set(recordingId, tracked);
    newest = tracked;
    return tracked;
  };

  return {
    configure(config) {
      protocol = config.eventsProtocol;
      mode = config.meetingNotes;
      for (const { sender } of recordings.values()) sender.setEnabled(protocol >= 1);
    },
    recordingStarted(recording, start) {
      const atMs = deps.now();
      const facts = starts.started(recording, start, atMs);
      if (mode !== 'off' && !recordings.has(recording.id)) {
        const media = recording.video === null ? 'audio' : 'video';
        const event = { type: 'recording-started', ...facts, media, ...STATES_AT_START } as const;
        stamp(track(recording.id), recording, event, atMs);
      }
      return facts;
    },
    record(recording, event) {
      const tracked = recording ? recordings.get(recording.id) : undefined;
      if (recording && tracked && !tracked.stopped) stamp(tracked, recording, event, deps.now());
    },
    recordingStopped(recording, reason) {
      starts.stopped(recording.id, deps.now());
      const tracked = recordings.get(recording.id);
      if (!tracked || tracked.stopped) return;
      stamp(tracked, recording, { type: 'recording-stopped', reason }, deps.now());
      // Only now: when Firefox stops a closing tab's script before this line, the next call
      // stamps it again (the background stores each seq once).
      tracked.stopped = true;
    },
    counts: (recordingId) => countsOf(recordings.get(recordingId)),
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
