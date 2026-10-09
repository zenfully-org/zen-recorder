import { buildNotesCoverage } from '@/lib/notes/build-notes-coverage';
import { buildNotesParticipants } from '@/lib/notes/build-notes-participants';
import { cleanText } from '@/lib/notes/clean-text';
import { deriveNotesSignals } from '@/lib/notes/derive-notes-signals';
import { formatIsoWithOffset } from '@/lib/notes/format-iso-with-offset';
import { type EventCounts, judgeNotesCompleteness } from '@/lib/notes/judge-notes-completeness';
import { leafOfPath } from '@/lib/notes/leaf-of-path';
import {
  mapNotesEvents,
  type NotesClock,
  type StoredNotesEvent,
} from '@/lib/notes/map-notes-events';
import type { MeetingNotesDocument, NotesEvent } from '@/lib/notes/parse-meeting-notes';
import { placeInFile } from '@/lib/notes/place-in-file';

/** Where the format is documented; every notes file names it. */
const SCHEMA_URL =
  'https://github.com/zenfully-org/zen-recorder/blob/main/docs/meeting-notes-format.md';

/** What the notes of one saved recording are built from. */
export interface MeetingNotesInput {
  /** What the background stored about the recording, and its event counts. */
  recording: Omit<EventCounts, 'notesOffWhileRecording'> & {
    id: string;
    /** Provider id (`meet`, `zoom`, `teams`) and its name for people. */
    service: string;
    serviceName: string;
    meetingId: string;
    title: string;
    /** The meeting's canonical link; a query or a fragment is dropped all the same. */
    url: string | null;
    /** Wall start (epoch ms), the page's `startedAt`. */
    startedAt: number;
    /** When the last chunk arrived (epoch ms): the end of a recording the page never stopped. */
    lastChunkAt?: number | undefined;
    /** The background's time zone when it first stored the recording. */
    timeZone?: string | undefined;
    hasVideo: boolean;
    /** Why it ended, as the background stored it. */
    endReason?: string | undefined;
  };
  /** The stored events, in any order. */
  events: readonly StoredNotesEvent[];
  /** The saved file: its name (a path, of which only the name is written), and the remux's facts. */
  file: {
    saved: string;
    raw: string | null;
    /** The remux input's end timestamp; null when it could not be read. */
    durationMs: number | null;
    /** Where the remux moved the file's start: taken off every position. */
    startOffsetMs: number;
    remuxed: boolean;
  };
  /** The saved file this recording continues, when its start says it continues one. */
  previousFile?: string | null | undefined;
  notes: 'withNames' | 'withoutNames';
  /** Notes were off while the page recorded: it collected nothing. */
  notesOffWhileRecording: boolean;
  /** The background's time zone now, for a recording stored without one. */
  timeZone: string;
  /** The extension's version. */
  generatorVersion: string;
  /** How late the page can stamp a change it shows: its tick. */
  detectionLatencyMs: number;
}

type Stored<Type extends StoredNotesEvent['type']> = Extract<StoredNotesEvent, { type: Type }>;
type Recording = MeetingNotesDocument['recording'];

const STOPPED = 'recording-stopped';

const find = <Type extends StoredNotesEvent['type']>(
  events: readonly StoredNotesEvent[],
  type: Type,
): Stored<Type> | undefined => events.find((event): event is Stored<Type> => event.type === type);

/** A link without its query or fragment, which can carry a passcode or the user's name. */
const withoutQuery = (url: string | null): string | null => {
  const cut = url === null ? -1 : url.search(/[?#]/);
  return url === null || cut === -1 ? url : url.slice(0, cut);
};

/**
 * The end: the page's stop, else the later of its last event and the last chunk, estimated. Never
 * the time of a recovery, which can come a day later.
 */
const endOf = (
  events: readonly StoredNotesEvent[],
  lastChunkAt: number | undefined,
): { endMs: number | null; estimated: boolean } => {
  const stopped = find(events, STOPPED);
  if (stopped) return { endMs: stopped.atMs, estimated: false };
  const seen = [...(lastChunkAt === undefined ? [] : [lastChunkAt]), ...events.map((e) => e.atMs)];
  return { endMs: seen.length === 0 ? null : Math.max(...seen), estimated: seen.length > 0 };
};

/** Wall time not recorded: every pause resumed, and one still open at the end. */
const pausedTime = (events: readonly StoredNotesEvent[], endMs: number): number => {
  const resumed = events.reduce(
    (sum, e) => (e.type === 'recording-resumed' ? sum + e.pausedMs : sum),
    0,
  );
  const lastPause = events.findLastIndex((event) => event.type === 'recording-paused');
  const pause = events[lastPause];
  const open =
    pause !== undefined && !events.slice(lastPause).some((e) => e.type === 'recording-resumed');
  return resumed + (open ? Math.max(0, endMs - pause.atMs) : 0);
};

/** A recovered recording's end, which the page never sent: added by the background at the file end. */
const recoveredEnd = (
  events: readonly StoredNotesEvent[],
  clock: NotesClock,
  end: string,
): NotesEvent[] => {
  const last = events.at(-1);
  if (last === undefined) return [];
  const mediaMs = clock.durationMs ?? placeInFile(last.mediaMs, clock).mediaMs;
  return [
    {
      seq: last.seq + 1,
      type: STOPPED,
      at: end,
      mediaMs,
      source: 'background',
      reason: 'recovered',
    },
  ];
};

const meetingOf = ({ recording }: MeetingNotesInput): MeetingNotesDocument['meeting'] => {
  const id = cleanText(recording.meetingId) || 'unknown';
  const { service, serviceName } = recording;
  return {
    service,
    serviceName,
    id,
    title: cleanText(recording.title) || id,
    url: withoutQuery(recording.url),
  };
};

/** What the file holds, and why no video when it has none. */
const mediaOf = (
  hasVideo: boolean,
  started: Stored<'recording-started'> | undefined,
): Pick<Recording, 'media' | 'audioOnlyReason'> =>
  hasVideo
    ? { media: 'video+audio', audioOnlyReason: null }
    : { media: 'audio', audioOnlyReason: started?.audioOnlyReason ?? null };

/** Why it ended: recovered, else as the background stored it, else as the page's stop said. */
const endReasonOf = (
  recording: MeetingNotesInput['recording'],
  stopped: Stored<'recording-stopped'> | undefined,
): string | null => {
  if (recording.recovered) return 'recovered';
  return recording.endReason ?? stopped?.reason ?? null;
};

/** The file of the same meeting this recording continues, as its start names it. */
const continuesOf = (
  started: Stored<'recording-started'> | undefined,
  previousFile: string | null | undefined,
): Recording['continues'] => {
  if (started === undefined || started.continuesRecordingId === null) return null;
  const file = previousFile == null ? null : leafOfPath(previousFile);
  return { recordingId: started.continuesRecordingId, file, gapMs: started.gapMs };
};

/** The times and the file of the recording, from its stored events and the saved file. */
const recordingOf = (
  input: MeetingNotesInput,
  stored: readonly StoredNotesEvent[],
  clock: NotesClock,
): Recording => {
  const { recording, file } = input;
  const { endMs, estimated } = endOf(stored, recording.lastChunkAt);
  const started = find(stored, 'recording-started');
  return {
    id: recording.id,
    file: leafOfPath(file.saved),
    rawFile: file.raw === null ? null : leafOfPath(file.raw),
    start: formatIsoWithOffset(recording.startedAt, clock.timeZone),
    end: endMs === null ? null : formatIsoWithOffset(endMs, clock.timeZone),
    timeZone: clock.timeZone,
    durationMs: clock.durationMs,
    pausedMs: pausedTime(stored, endMs ?? recording.startedAt),
    mediaOffsetMs: clock.mediaOffsetMs,
    ...mediaOf(recording.hasVideo, started),
    seekable: file.remuxed,
    recovered: recording.recovered,
    endEstimated: estimated,
    startCause: started?.cause ?? null,
    endReason: endReasonOf(recording, find(stored, STOPPED)),
    continues: continuesOf(started, input.previousFile),
  };
};

/**
 * The notes document of one saved recording, from what the background stored: its facts, its
 * events, the saved file and the settings. Positions are in the saved file (past the remux's
 * start offset, clamped to its end), times in the recording's time zone, names only with
 * `withNames`. It says what is missing and why: the end when the page never stopped, the events
 * the page did not send, the spans a signal was not observed.
 */
export function buildMeetingNotes(input: MeetingNotesInput): MeetingNotesDocument {
  const { recording, file } = input;
  const mediaOffsetMs = Math.max(0, file.startOffsetMs);
  const clock: NotesClock = {
    timeZone: recording.timeZone ?? input.timeZone,
    mediaOffsetMs,
    durationMs: file.durationMs === null ? null : Math.max(0, file.durationMs - mediaOffsetMs),
    names: input.notes === 'withNames',
  };
  const stored = [...input.events].sort((a, b) => a.seq - b.seq);
  const pageEvents = mapNotesEvents(stored, clock);
  const notesRecording = recordingOf(input, stored, clock);
  const { end, start } = notesRecording;
  const recoveredRow = recording.recovered && !find(stored, STOPPED) && end !== null;
  const lastMs = Math.max(0, ...pageEvents.map((event) => event.mediaMs));
  const counts = { ...recording, notesOffWhileRecording: input.notesOffWhileRecording };
  return {
    schema: 'zen-recorder/meeting-notes',
    schemaVersion: '1.0',
    schemaUrl: SCHEMA_URL,
    generator: { name: 'zen-recorder', version: input.generatorVersion },
    meeting: meetingOf(input),
    recording: notesRecording,
    capture: {
      ...judgeNotesCompleteness(
        counts,
        stored.map((event) => event.seq),
      ),
      names: clock.names,
      ...deriveNotesSignals(pageEvents),
      detectionLatencyMs: input.detectionLatencyMs,
      coverage: buildNotesCoverage(pageEvents, {
        at: end ?? start,
        mediaMs: clock.durationMs ?? lastMs,
      }),
    },
    participants: buildNotesParticipants(stored, clock),
    events: recoveredRow ? [...pageEvents, ...recoveredEnd(stored, clock, end)] : pageEvents,
  };
}
