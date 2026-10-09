/**
 * Stored meeting events, as the page stamped them, mapped to the events a notes file writes: wall
 * times as ISO in the meeting's time zone, positions in the saved file, participants by their
 * notes-local id, names only when they are collected.
 */
import { cleanText } from '@/lib/notes/clean-text';
import { formatIsoWithOffset } from '@/lib/notes/format-iso-with-offset';
import type { NotesEvent } from '@/lib/notes/parse-meeting-notes';
import { placeInFile } from '@/lib/notes/place-in-file';

type MicState = 'live' | 'muted' | 'not-connected';

/** A participant as the page refers to one: its notes-local id, never the service's own. */
export interface StoredParticipantRef {
  id: string;
  /** The name shown; null when names are off or the page shows none. */
  name: string | null;
  /** True for the user's own participant; null when the provider cannot tell. */
  self: boolean | null;
  /** How the page merged appearances into this id; a guess (`display-name`) when not said. */
  identity?: 'service-id' | 'display-name';
}

/** What the page stamps on every event when it detects it. */
interface Stamp {
  /** Order of the timeline, per recording; a gap is an event the page dropped. */
  seq: number;
  /** Wall time (epoch ms). */
  atMs: number;
  /** Position in the recording as the encoder counted it, before the remux's start offset. */
  mediaMs: number;
  /** Detected while paused: `mediaMs` is the pause position. */
  paused?: true;
}

type Capabilities = {
  count: boolean;
  roster: boolean;
  self: boolean;
  share: boolean;
  shareBy: boolean;
};

/** One stored event: the page's stamp and the payload of its type. */
export type StoredNotesEvent = Stamp &
  (
    | {
        type: 'recording-started';
        cause: string | null;
        media: 'video' | 'audio' | null;
        audioOnlyReason: string | null;
        continuesRecordingId: string | null;
        gapMs: number | null;
        mic: MicState | null;
        tabVisible: boolean | null;
        ownShare: boolean | null;
      }
    | { type: 'recording-paused' }
    | { type: 'recording-resumed'; pausedMs: number }
    | { type: 'recording-stopped'; reason: string }
    | {
        type: 'roster';
        why: 'start' | 'reannounce' | 'stop';
        source: 'roster' | 'stage' | null;
        participants: readonly StoredParticipantRef[];
        count: number | null;
        share: 'none' | 'unknown' | 'active';
        shareBy: StoredParticipantRef | null;
        stale: boolean;
        readAtMs: number;
        capabilities: Capabilities | null;
      }
    | {
        type: 'participant-joined' | 'participant-left';
        participant: StoredParticipantRef | null;
        count: number | null;
      }
    | { type: 'participant-renamed'; participant: StoredParticipantRef; from: string | null }
    | { type: 'participant-count'; count: number }
    | { type: 'share-started' | 'share-stopped'; by: StoredParticipantRef | null }
    | { type: 'mic'; state: MicState }
    | { type: 'connection-lost' }
    | { type: 'connection-restored'; lostMs: number }
    | { type: 'video-failed' }
    | { type: 'title-changed'; title: string }
    | { type: 'extension-reloaded' }
    | { type: 'coverage-lost' | 'coverage-restored'; signal: string; reason: string }
  );

/** How stored times become the file's: its time zone, its start offset, its length. */
export interface NotesClock {
  timeZone: string;
  /** Taken off every position: the remux moved the file's start there. */
  mediaOffsetMs: number;
  /** The file's length; a position past it is placed at it. Null when not known. */
  durationMs: number | null;
  /** Names are collected (`withNames`). */
  names: boolean;
}

type Stored<Type extends StoredNotesEvent['type']> = Extract<StoredNotesEvent, { type: Type }>;
type Base = Pick<NotesEvent, 'seq' | 'at' | 'mediaMs' | 'source' | 'paused' | 'clamped'>;

const idOf = (ref: StoredParticipantRef | null): string | null => ref?.id ?? null;

const RECORDING = new Set<string>([
  'recording-started',
  'recording-paused',
  'recording-resumed',
  'recording-stopped',
  'video-failed',
  'title-changed',
  'extension-reloaded',
]);
type RecordingEvent = Stored<
  | 'recording-started'
  | 'recording-paused'
  | 'recording-resumed'
  | 'recording-stopped'
  | 'video-failed'
  | 'title-changed'
  | 'extension-reloaded'
>;
const isRecording = (event: StoredNotesEvent): event is RecordingEvent => RECORDING.has(event.type);

const mapRecording = (event: RecordingEvent, base: Base): NotesEvent => {
  switch (event.type) {
    case 'recording-started': {
      const { cause, media, audioOnlyReason, continuesRecordingId, gapMs, mic } = event;
      const { tabVisible, ownShare } = event;
      const started = { cause, media, audioOnlyReason, continuesRecordingId, gapMs, mic };
      return { ...base, type: event.type, ...started, tabVisible, ownShare };
    }
    case 'recording-resumed':
      return { ...base, type: event.type, pausedMs: event.pausedMs };
    case 'recording-stopped':
      return { ...base, type: event.type, reason: event.reason };
    case 'title-changed':
      return { ...base, type: event.type, title: cleanText(event.title) };
    case 'recording-paused':
    case 'video-failed':
    case 'extension-reloaded':
      return { ...base, type: event.type };
  }
};

const PEOPLE = new Set<string>([
  'roster',
  'participant-joined',
  'participant-left',
  'participant-renamed',
  'share-started',
  'share-stopped',
]);
type PeopleEvent = Stored<
  | 'roster'
  | 'participant-joined'
  | 'participant-left'
  | 'participant-renamed'
  | 'share-started'
  | 'share-stopped'
>;
const isPeople = (event: StoredNotesEvent): event is PeopleEvent => PEOPLE.has(event.type);

const mapPeople = (event: PeopleEvent, base: Base, clock: NotesClock): NotesEvent => {
  switch (event.type) {
    case 'roster': {
      const { why, count, share, stale, capabilities } = event;
      const present = event.participants.map((participant) => participant.id);
      const reading = { why, participantSource: event.source, present, count, share };
      const readAt = formatIsoWithOffset(event.readAtMs, clock.timeZone);
      return {
        ...base,
        type: event.type,
        ...reading,
        shareBy: idOf(event.shareBy),
        stale,
        readAt,
        capabilities,
      };
    }
    case 'participant-joined':
    case 'participant-left':
      return {
        ...base,
        type: event.type,
        participant: idOf(event.participant),
        count: event.count,
      };
    case 'participant-renamed': {
      const from = clock.names && event.from !== null ? cleanText(event.from) : null;
      return { ...base, type: event.type, participant: event.participant.id, from };
    }
    case 'share-started':
    case 'share-stopped':
      return { ...base, type: event.type, by: idOf(event.by) };
  }
};

type SignalEvent = Exclude<StoredNotesEvent, RecordingEvent | PeopleEvent>;

const mapSignal = (event: SignalEvent, base: Base): NotesEvent => {
  switch (event.type) {
    case 'participant-count':
      return { ...base, type: event.type, count: event.count };
    case 'mic':
      return { ...base, type: event.type, state: event.state };
    case 'connection-restored':
      return { ...base, type: event.type, lostMs: event.lostMs };
    case 'coverage-lost':
    case 'coverage-restored':
      return { ...base, type: event.type, signal: event.signal, reason: event.reason };
    case 'connection-lost':
      return { ...base, type: event.type };
  }
};

const mapEvent = (event: StoredNotesEvent, clock: NotesClock): NotesEvent => {
  const base: Base = {
    seq: event.seq,
    at: formatIsoWithOffset(event.atMs, clock.timeZone),
    ...placeInFile(event.mediaMs, clock),
    source: 'page',
    ...(event.paused ? { paused: true } : {}),
  };
  if (isRecording(event)) return mapRecording(event, base);
  if (isPeople(event)) return mapPeople(event, base, clock);
  return mapSignal(event, base);
};

/** The stored events in `seq` order, as a notes file writes them. */
export function mapNotesEvents(
  events: readonly StoredNotesEvent[],
  clock: NotesClock,
): NotesEvent[] {
  return [...events].sort((a, b) => a.seq - b.seq).map((event) => mapEvent(event, clock));
}
