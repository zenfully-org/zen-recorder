import { cleanText } from '@/lib/notes/clean-text';
import type {
  NotesClock,
  StoredNotesEvent,
  StoredParticipantRef,
} from '@/lib/notes/map-notes-events';
import type { NotesParticipant } from '@/lib/notes/parse-meeting-notes';
import { placeInFile } from '@/lib/notes/place-in-file';

/** A participant while the events are read: what is known so far, and whether a span is open. */
interface Seen {
  id: string;
  /** Every name shown, in the order first seen. */
  names: string[];
  /** The name it showed last. */
  current: string | null;
  self: boolean | null;
  identity: NotesParticipant['identity'];
  spans: { joinedMs: number | null; leftMs: number | null }[];
  present: boolean;
}

/** Every participant an event refers to, rosters and the sharer included. */
const refsOf = (event: StoredNotesEvent): readonly (StoredParticipantRef | null)[] => {
  switch (event.type) {
    case 'roster':
      return [...event.participants, event.shareBy];
    case 'participant-joined':
    case 'participant-left':
    case 'participant-renamed':
      return [event.participant];
    case 'share-started':
    case 'share-stopped':
      return [event.by];
    default:
      return [];
  }
};

/** A name shown; the current one unless it is the name a rename replaced. */
const addName = (seen: Seen, name: string | null, current: boolean): void => {
  const clean = name === null ? '' : cleanText(name);
  if (clean === '') return;
  if (!seen.names.includes(clean)) seen.names.push(clean);
  if (current) seen.current = clean;
};

const join = (seen: Seen, joinedMs: number | null): void => {
  if (seen.present) return;
  seen.spans.push({ joinedMs, leftMs: null });
  seen.present = true;
};

const leave = (seen: Seen, leftMs: number): void => {
  const open = seen.present ? seen.spans.at(-1) : undefined;
  if (open) open.leftMs = leftMs;
  else if (seen.spans.length === 0) seen.spans.push({ joinedMs: null, leftMs });
  seen.present = false;
};

/** Presence: the start roster opens spans at the file's start, joins and leaves move them. */
const track = (
  event: StoredNotesEvent,
  mediaMs: number,
  byId: (ref: StoredParticipantRef) => Seen,
) => {
  if (event.type === 'roster' && event.why === 'start') {
    for (const ref of event.participants) join(byId(ref), null);
  } else if (event.type === 'participant-joined' && event.participant !== null) {
    join(byId(event.participant), mediaMs);
  } else if (event.type === 'participant-left' && event.participant !== null) {
    leave(byId(event.participant), mediaMs);
  } else if (event.type === 'participant-renamed') {
    addName(byId(event.participant), event.from, false);
  }
};

const presentIn = (rosterIds: readonly string[] | undefined, id: string): boolean | null =>
  rosterIds === undefined ? null : rosterIds.includes(id);

/**
 * Everyone the events refer to, in the order they were first seen: every name shown (renames
 * included, without names none), whether it is the user, how the page merged them, whether they
 * were there at the start and at the end, and the spans of the file they were in. `events` are in
 * `seq` order.
 */
export function buildNotesParticipants(
  events: readonly StoredNotesEvent[],
  clock: NotesClock,
): NotesParticipant[] {
  const { names } = clock;
  const all = new Map<string, Seen>();
  const byId = (ref: StoredParticipantRef): Seen => {
    const seen = all.get(ref.id) ?? {
      id: ref.id,
      names: [],
      current: null,
      self: null,
      identity: 'display-name',
      spans: [],
      present: false,
    };
    all.set(ref.id, seen);
    if (ref.self !== null && seen.self !== true) seen.self = ref.self;
    if (ref.identity !== undefined) seen.identity = ref.identity;
    return seen;
  };
  for (const event of events) {
    // A rename adds the old name before the new one is read from its reference below.
    track(event, placeInFile(event.mediaMs, clock).mediaMs, byId);
    for (const ref of refsOf(event)) if (ref !== null) addName(byId(ref), ref.name, true);
  }
  const rosters = events.filter((event) => event.type === 'roster');
  const ids = (why: 'start' | 'stop') =>
    rosters
      .find((roster) => roster.type === 'roster' && roster.why === why)
      ?.participants.map((ref) => ref.id);
  return [...all.values()].map((seen) => ({
    id: seen.id,
    name: names ? seen.current : null,
    names: names ? seen.names : [],
    self: seen.self,
    identity: seen.identity,
    presentAtStart: presentIn(ids('start'), seen.id),
    presentAtEnd: presentIn(ids('stop'), seen.id),
    spans: seen.spans,
  }));
}
