/**
 * Who joined, left or was renamed, from one presence reading to the next, for the meeting notes.
 * Readings name people by the notes' own ids (`assignParticipantIds`). The first reading is the
 * baseline: whoever is in it was there at the start, never "joined".
 *
 *   - A roster (the page lists everyone in the call): someone who appears joined, someone who
 *     vanishes left.
 *   - The stage (only the people on screen): someone off screen may still be in the call, so a
 *     person is named as joining or leaving only when the stage shows everyone (as many people as
 *     the page counts, the user included) and the count moved by as many people as came or went;
 *     a join must be someone not in the call before. Counter and tiles update at different moments,
 *     so a change of either waits 3 s for the other. Otherwise only the count is told; without a
 *     count, nothing. In a paged gallery someone off screen joins while someone already in the
 *     call scrolls into view, and a rule on the count alone would name the wrong person.
 *   - A leave waits 10 s: someone back within it (a reconnect, a device switch) neither left nor
 *     joined.
 *   - No reading (the call is not on screen): the coverage of the participants is lost until one
 *     comes back, what was known holds, and what changed meanwhile is told when it is seen.
 *
 * Every event keeps the moment it was first seen. The user never joins or leaves.
 */
import type { MeetingEventBody, ParticipantRef } from '@/lib/types';

/** What one reading shows of the people, by the notes' ids. */
export interface PresenceReading {
  source: 'roster' | 'stage';
  participants: readonly ParticipantRef[];
  /** The page's count, the user included; null when it shows none. */
  count: number | null;
}

type Body = Extract<
  MeetingEventBody,
  {
    type:
      | 'participant-joined'
      | 'participant-left'
      | 'participant-renamed'
      | 'participant-count'
      | 'coverage-lost'
      | 'coverage-restored';
  }
>;

/** A leave waiting for the person to come back. */
interface HeldLeave<Stamp> {
  stamp: Stamp;
  participant: ParticipantRef;
  count: number | null;
}

/** What changed on the stage since the diff last settled, while it waits for its match. */
interface Pending<Stamp> {
  opened: Stamp;
  /** When the count first differed from the settled one; null while it does not. */
  countAt: Stamp | null;
  /** The newest count read. */
  count: number;
  /** When each person who came on or went off the stage was first seen doing so. */
  seen: ReadonlyMap<string, Stamp>;
}

export interface PresenceState<Stamp> {
  /** A reading came: the diff has a baseline. */
  baseline: boolean;
  /** Everyone in the call as the readings proved it, by id. */
  present: ReadonlyMap<string, ParticipantRef>;
  /** Who the page showed, and its count, when the diff last settled. */
  shown: ReadonlySet<string>;
  count: number | null;
  leaving: ReadonlyMap<string, HeldLeave<Stamp>>;
  pending: Pending<Stamp> | null;
  /** The last reading was none: the coverage is lost. */
  unavailable: boolean;
}

interface Told<Stamp> {
  stamp: Stamp;
  body: Body;
}

/** How long a count or a stage change waits for the other, and a leave for a return. */
const MATCH_HOLD_MS = 3_000;
const LEAVE_HOLD_MS = 10_000;
const UNAVAILABLE = { signal: 'participants', reason: 'presence-unavailable' } as const;

/**
 * The diff at work on one reading: the state it started from, its own copies of what it may
 * change, the moment of the reading and what it told so far.
 */
interface Working<Stamp> {
  before: PresenceState<Stamp>;
  present: Map<string, ParticipantRef>;
  leaving: Map<string, HeldLeave<Stamp>>;
  stamp: Stamp;
  told: Told<Stamp>[];
}

const EMPTY: PresenceState<never> = {
  baseline: false,
  present: new Map(),
  shown: new Set(),
  count: null,
  leaving: new Map(),
  pending: null,
  unavailable: false,
};

const earliest = <Stamp extends { atMs: number }>(first: Stamp, other: Stamp | undefined): Stamp =>
  other && other.atMs < first.atMs ? other : first;

const notUser = (participant: ParticipantRef) => participant.self !== true;

/** The reading's people, each once, by id. */
const byId = (reading: PresenceReading) =>
  new Map(reading.participants.map((participant) => [participant.id, participant]));

/** Renames of people known before: a key that survived a change of name. */
function rename<Stamp>(work: Working<Stamp>, shown: Map<string, ParticipantRef>) {
  const { stamp } = work;
  for (const participant of shown.values()) {
    const known = work.present.get(participant.id) ?? work.leaving.get(participant.id)?.participant;
    const from = known?.name ?? null;
    if (from !== null && participant.name !== null && from !== participant.name) {
      work.told.push({ stamp, body: { type: 'participant-renamed', participant, from } });
    }
    if (work.present.has(participant.id)) work.present.set(participant.id, participant);
  }
}

/** `participant` is in the call; back within the hold of their leave, the leave never was. */
function arrive<Stamp>(
  work: Working<Stamp>,
  participant: ParticipantRef,
  join: Told<Stamp> | null,
) {
  const returned = work.leaving.delete(participant.id);
  work.present.set(participant.id, participant);
  if (join && !returned && notUser(participant)) work.told.push(join);
}

function depart<Stamp>(work: Working<Stamp>, leave: HeldLeave<Stamp>) {
  work.present.delete(leave.participant.id);
  work.leaving.set(leave.participant.id, leave);
}

const joined = <Stamp>(stamp: Stamp, participant: ParticipantRef, count: number | null) => ({
  stamp,
  body: { type: 'participant-joined' as const, participant, count },
});

/** A full list: who appears joined, who vanishes left. */
function diffRoster<Stamp>(
  work: Working<Stamp>,
  reading: PresenceReading,
  shown: Map<string, ParticipantRef>,
) {
  const { stamp } = work;
  for (const participant of shown.values()) {
    if (!work.present.has(participant.id))
      arrive(work, participant, joined(stamp, participant, reading.count));
  }
  for (const participant of [...work.present.values()]) {
    if (!shown.has(participant.id) && notUser(participant))
      depart(work, { stamp, participant, count: reading.count });
  }
}

/** The stage as the diff settles on it: everyone on it is in the call, a full one shows all. */
function settle<Stamp>(
  work: Working<Stamp>,
  reading: PresenceReading,
  shown: Map<string, ParticipantRef>,
): void {
  for (const participant of shown.values())
    if (!work.present.has(participant.id)) arrive(work, participant, null);
  if (shown.size !== reading.count) return;
  for (const participant of [...work.present.values()]) {
    if (!shown.has(participant.id) && notUser(participant)) work.present.delete(participant.id);
  }
}

/** The changes waiting for a match, with those of this reading. */
function extend<Stamp>(
  { before: state, stamp }: Working<Stamp>,
  shown: Map<string, ParticipantRef>,
  count: number,
): Pending<Stamp> {
  const pending = state.pending;
  const seen = new Map(pending?.seen);
  const moved = [
    ...[...shown.keys()].filter((id) => !state.shown.has(id)),
    ...[...state.shown].filter((id) => !shown.has(id)),
  ];
  for (const id of moved) if (!seen.has(id)) seen.set(id, stamp);
  const countAt = count === state.count ? null : (pending?.countAt ?? stamp);
  return { opened: pending?.opened ?? stamp, countAt, count, seen };
}

/**
 * Named joins or leaves when the full stage shows exactly who the count says came or went, each
 * as of when it was first seen: their tile, or the count when it came first.
 */
function match<Stamp extends { atMs: number }>(
  work: Working<Stamp>,
  shown: Map<string, ParticipantRef>,
  pending: Pending<Stamp>,
  { countAt, delta }: { countAt: Stamp; delta: number },
): boolean {
  const at = (id: string) => earliest(countAt, pending.seen.get(id));
  const { count } = pending;
  if (delta > 0) {
    const newcomers = [...shown.values()].filter(
      (participant) => !work.present.has(participant.id) && notUser(participant),
    );
    if (newcomers.length !== delta) return false;
    for (const participant of newcomers)
      arrive(work, participant, joined(at(participant.id), participant, count));
    return true;
  }
  const gone = [...work.present.values()].filter(
    (participant) => !shown.has(participant.id) && notUser(participant),
  );
  if (gone.length !== -delta) return false;
  for (const participant of gone) depart(work, { stamp: at(participant.id), participant, count });
  return true;
}

/** The stage and the count are as the diff settled on them. */
const sameStage = <Stamp>(
  state: PresenceState<Stamp>,
  count: number,
  shown: Map<string, ParticipantRef>,
) =>
  count === state.count &&
  shown.size === state.shown.size &&
  [...shown.keys()].every((id) => state.shown.has(id));

/**
 * A change of the stage or of the count by `delta`: named once a full stage matches it, else the
 * count once it waited long enough; until then it waits.
 */
function weigh<Stamp extends { atMs: number }>(
  work: Working<Stamp>,
  reading: PresenceReading,
  shown: Map<string, ParticipantRef>,
  { count, delta }: { count: number; delta: number },
): Pending<Stamp> | null {
  const pending = extend(work, shown, count);
  const { countAt } = pending;
  const matched =
    countAt !== null && shown.size === count && match(work, shown, pending, { countAt, delta });
  const waited = work.stamp.atMs - (countAt ?? pending.opened).atMs >= MATCH_HOLD_MS;
  if (!matched && !waited) return pending;
  if (!matched && countAt) {
    work.told.push({ stamp: countAt, body: { type: 'participant-count', count } });
  }
  settle(work, reading, shown);
  return null;
}

/** The stage: named changes only with a full stage and a count that agrees, else the count. */
function diffStage<Stamp extends { atMs: number }>(
  work: Working<Stamp>,
  reading: PresenceReading,
  shown: Map<string, ParticipantRef>,
): Pending<Stamp> | null {
  const { count } = reading;
  const settled = work.before.count;
  if (count === null || settled === null || sameStage(work.before, count, shown)) {
    settle(work, reading, shown);
    return null;
  }
  return weigh(work, reading, shown, { count, delta: count - settled });
}

/** Leaves held long enough, or all of them when the recording ends; the count still waiting too. */
function release<Stamp extends { atMs: number }>(
  work: Working<Stamp>,
  pending: Pending<Stamp> | null,
  final: boolean,
): Pending<Stamp> | null {
  const { stamp } = work;
  for (const [id, leave] of work.leaving) {
    if (!final && stamp.atMs - leave.stamp.atMs < LEAVE_HOLD_MS) continue;
    work.leaving.delete(id);
    const { participant, count } = leave;
    work.told.push({ stamp: leave.stamp, body: { type: 'participant-left', participant, count } });
  }
  if (!final) return pending;
  if (pending?.countAt) {
    const body = { type: 'participant-count' as const, count: pending.count };
    work.told.push({ stamp: pending.countAt, body });
  }
  return null;
}

/**
 * No reading: the coverage is lost, once, and what the readings showed before holds. Not at the
 * end: after a leave the page shows no call, and the stop's reading says so itself.
 */
function withoutReading<Stamp>(work: Working<Stamp>, final: boolean): PresenceState<Stamp> {
  const { before, stamp } = work;
  if (!before.unavailable && !final)
    work.told.push({ stamp, body: { type: 'coverage-lost', ...UNAVAILABLE } });
  return { ...before, pending: null, unavailable: true };
}

/** A reading: the baseline, or what changed since the readings before. */
function withReading<Stamp extends { atMs: number }>(
  work: Working<Stamp>,
  reading: PresenceReading,
): PresenceState<Stamp> {
  const { before, stamp } = work;
  if (before.unavailable)
    work.told.push({ stamp, body: { type: 'coverage-restored', ...UNAVAILABLE } });
  const shown = byId(reading);
  let pending: Pending<Stamp> | null = null;
  if (!before.baseline) for (const participant of shown.values()) arrive(work, participant, null);
  else {
    rename(work, shown);
    if (reading.source === 'roster') diffRoster(work, reading, shown);
    else pending = diffStage(work, reading, shown);
  }
  const settled = pending === null;
  return {
    ...before,
    baseline: true,
    shown: settled ? new Set(shown.keys()) : before.shown,
    count: settled ? reading.count : before.count,
    pending,
    unavailable: false,
  };
}

/**
 * The events between the readings so far (`state`, null at the start of a recording) and
 * `reading`, seen at `stamp` (null: the page showed none), and the state to go on from. `final`
 * ends the recording: what still waits is told. Leaves `state` as it was.
 */
export function diffPresence<Stamp extends { atMs: number }>(
  state: PresenceState<Stamp> | null,
  reading: PresenceReading | null,
  stamp: Stamp,
  final = false,
): { state: PresenceState<Stamp>; events: Told<Stamp>[] } {
  const before: PresenceState<Stamp> = state ?? EMPTY;
  const work: Working<Stamp> = {
    before,
    present: new Map(before.present),
    leaving: new Map(before.leaving),
    stamp,
    told: [],
  };
  const next = reading === null ? withoutReading(work, final) : withReading(work, reading);
  const pending = release(work, next.pending, final);
  return {
    state: { ...next, present: work.present, leaving: work.leaving, pending },
    events: work.told,
  };
}
