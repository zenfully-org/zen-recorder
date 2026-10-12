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
import { createPauseTally } from '@/lib/page/create-pause-tally';
import { createSettleWaits } from '@/lib/page/create-settle-waits';
import { createSignalEvents, type Seen } from '@/lib/page/create-signal-events';
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
   * The events protocol the bridge speaks (0 sends nothing), the notes setting, and the bridge's
   * id, from its configure. A recording started while the notes are `off` gets no events. A new
   * bridge id while `running` records means the extension was reloaded or updated meanwhile.
   */
  configure(
    config: {
      eventsProtocol: number;
      meetingNotes: MeetingNotesMode;
      bridgeId?: string | undefined;
    },
    running?: TrackedRecording | null,
  ): void;
  /**
   * Once per recording; a second start is ignored. Gives what its announcement says of it: why it
   * started, why without video, and what it continues. Said with the notes off too: the notes
   * setting can be turned on before the recording is saved.
   */
  recordingStarted(recording: TrackedRecording, start: NotesStart, seen: Seen): StartFacts;
  /** Stamps `event` of a recording it tracks; nothing once its stop is stamped. */
  record(recording: TrackedRecording | null, event: RecordingEvent): void;
  /** Before the encoder pauses, so the pause is stamped where it cuts the file. */
  paused(recording: TrackedRecording | null): void;
  /** After the encoder resumed, with how long the pause lasted. */
  resumed(recording: TrackedRecording | null): void;
  /**
   * What the page sees of the call now, read at every change and every tick: a connection lost for
   * 2 s, and restored, is written as of the moment it went.
   */
  observe(recording: TrackedRecording | null, seen: Seen): void;
  /** Stamped before the encoder stops, so its place is the end of the file; once per recording. */
  recordingStopped(recording: TrackedRecording, reason: StopReason): void;
  /** The wall time recording `recordingId` was paused, pauses its stop ended included. */
  pausedMs(recordingId: string): number;
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

/** What an event says of the moment it was seen: when, where in the file, whether paused. */
interface Stamp {
  atMs: number;
  mediaMs: number;
  paused?: true;
}

interface Tracked {
  sender: EventSender;
  nextSeq: number;
  stopped: boolean;
  /** What the page shows, from the recording's start on, and the events its changes make. */
  signals: ReturnType<typeof createSignalEvents<Stamp>>;
}

/** A recording's events as they stand: acked, dropped below that, and not acked yet. */
const countsOf = (tracked: Tracked | undefined): MeetingEventCounts =>
  countMeetingEvents({
    lastAckedSeq: tracked?.sender.lastAckedSeq() ?? -1,
    dropped: tracked?.sender.dropped() ?? [],
    nextSeq: tracked?.nextSeq ?? 0,
  });

/** The moment `atMs` of `recording`: its place in the file in whole ms, and whether it is paused. */
const stampOf = (recording: TrackedRecording, atMs: number): Stamp => {
  const paused = recording.encoder.state() === 'paused';
  const mediaMs = Math.round(recording.encoder.mediaTimeMs());
  return { atMs, mediaMs, ...(paused ? { paused: true } : {}) };
};

/**
 * Numbers `event`, seen at `stamp`, and queues it. The number is taken only once the event is
 * queued: a call stopped short before that leaves the next call to stamp it again.
 */
function enqueue(tracked: Tracked, stamp: Stamp, event: MeetingEventBody): void {
  const seq = tracked.nextSeq;
  tracked.sender.enqueue({ ...event, seq, ...stamp });
  tracked.nextSeq = seq + 1;
}

/** A recording's events from its first, delivered while `enabled`. */
const trackRecording = (
  recordingId: string,
  deps: NotesTrackerDeps,
  enabled: boolean,
  seen: Seen,
): Tracked => {
  const sender = createEventSender({
    recordingId,
    send: deps.send,
    isDroppable: isDroppableMeetingEvent,
    setTimeout: deps.setTimeout,
    ...(deps.clearTimeout ? { clearTimeout: deps.clearTimeout } : {}),
  });
  sender.setEnabled(enabled);
  return { sender, nextSeq: 0, stopped: false, signals: createSignalEvents<Stamp>(seen) };
};

/** Where the newest recording's events stand, for the page's debug view. */
const debugOf = (protocol: number, newest: Tracked | null) => ({
  protocol,
  lastSeq: (newest?.nextSeq ?? 0) - 1,
  pending: newest?.sender.pending() ?? 0,
  acked: newest?.sender.lastAckedSeq() ?? -1,
});

export function createNotesTracker(deps: NotesTrackerDeps): NotesTracker {
  const recordings = new Map<string, Tracked>();
  let newest: Tracked | null = null;
  let protocol = 0;
  let mode: MeetingNotesMode = 'withNames';
  let bridgeId = '';
  const starts = createStartFacts();
  const pauses = createPauseTally();
  const waits = createSettleWaits(deps);

  /** The recording's events while it runs: none once its stop is stamped, or with notes off. */
  const running = (recording: TrackedRecording | null | undefined) => {
    const tracked = recording ? recordings.get(recording.id) : undefined;
    return recording && tracked && !tracked.stopped ? { recording, tracked } : null;
  };
  const record = (recording: TrackedRecording | null | undefined, event: MeetingEventBody) => {
    const found = running(recording);
    if (found) enqueue(found.tracked, stampOf(found.recording, deps.now()), event);
  };

  return {
    configure(config, active) {
      protocol = config.eventsProtocol;
      mode = config.meetingNotes;
      for (const { sender } of recordings.values()) sender.setEnabled(protocol >= 1);
      const next = config.bridgeId ?? '';
      if (bridgeId !== '' && next !== '' && next !== bridgeId) {
        record(active, { type: 'extension-reloaded' });
      }
      bridgeId = next || bridgeId;
    },
    recordingStarted(recording, start, seen) {
      const atMs = deps.now();
      const facts = starts.started(recording, start, atMs);
      if (mode !== 'off' && !recordings.has(recording.id)) {
        const media = recording.video === null ? 'audio' : 'video';
        newest = trackRecording(recording.id, deps, protocol >= 1, seen);
        recordings.set(recording.id, newest);
        // The states at the start, so one that never changes is still written; the own share is
        // not read yet.
        const states = { mic: seen.mic, tabVisible: seen.visible, ownShare: null };
        const stamp = stampOf(recording, atMs);
        enqueue(newest, stamp, { type: 'recording-started', ...facts, media, ...states });
        for (const body of newest.signals.atStart()) enqueue(newest, stamp, body);
      }
      return facts;
    },
    record,
    paused(recording) {
      if (recording) pauses.paused(recording.id, deps.now());
      record(recording, { type: 'recording-paused' });
    },
    resumed(recording) {
      const pausedMs = recording ? pauses.ended(recording.id, deps.now()) : 0;
      record(recording, { type: 'recording-resumed', pausedMs });
    },
    observe(recording, seen) {
      const found = running(recording);
      if (!found) return;
      const atMs = deps.now();
      const stamp = () => stampOf(found.recording, atMs);
      for (const told of found.tracked.signals.observe(seen, atMs, stamp)) {
        enqueue(found.tracked, told.stamp, told.body);
      }
    },
    recordingStopped(recording, reason) {
      const atMs = deps.now();
      starts.stopped(recording.id, atMs);
      pauses.ended(recording.id, atMs);
      const tracked = recordings.get(recording.id);
      if (!tracked || tracked.stopped) return;
      enqueue(tracked, stampOf(recording, atMs), { type: 'recording-stopped', reason });
      // Only now: when Firefox stops a closing tab's script before this line, the next call
      // stamps it again (the background stores each seq once).
      tracked.stopped = true;
    },
    pausedMs: (recordingId) => pauses.total(recordingId),
    counts: (recordingId) => countsOf(recordings.get(recordingId)),
    whenSettled(recordingId, maxWaitMs, done) {
      const tracked = recordings.get(recordingId);
      const idle = tracked?.sender.whenIdle() ?? Promise.resolve();
      waits.add(idle, maxWaitMs, () => done(countsOf(tracked)));
    },
    settleNow: () => waits.settleNow(),
    debug: () => debugOf(protocol, newest),
  };
}
