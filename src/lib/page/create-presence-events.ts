/**
 * The events one recording's notes get from who is in the call: a reading of the call at the
 * start (with what the service can show at best), who joined, left or was renamed in between
 * (`diffPresence`), and a reading at the stop. Each reading names people by the notes' own ids
 * (`assignParticipantIds`), kept for the page's meeting across its recordings, so a meeting split
 * into files names everyone the same way in each; the service's own ids never leave this module.
 *
 * The user is always a participant, the first one, also where the page cannot tell which person
 * is the user (Zoom's stage shows the user's own tile as someone else). Where the page marks the
 * user, they count as on the stage even when their own tile is hidden, as the page's count does.
 *
 * After a leave the page shows no call any more, so the stop's reading is the last one the page
 * gave, marked stale, with when it was read: who was there at the end is not lost. Without names
 * collected, the events name no one; ids, the user and the counts stay.
 */
import { assignParticipantIds, type ParticipantIds } from '@/lib/notes/assign-participant-ids';
import { diffPresence, type PresenceReading, type PresenceState } from '@/lib/notes/diff-presence';
import { withoutParticipantNames } from '@/lib/page/without-participant-names';
import type { MeetingPresence } from '@/lib/providers/types';
import type { MeetingEventBody, NotesCapabilities, ParticipantRef } from '@/lib/types';

/** Where the readings come from: the provider, on the meeting page. */
export interface PresenceSource {
  /** Who is in the call now; null while the page shows no call. */
  read(): MeetingPresence | null;
  /** The most the service's page can show. */
  capabilities: NotesCapabilities;
}

type Roster = Extract<MeetingEventBody, { type: 'roster' }>;

/** A reading as the notes name it, and when it was read. */
interface Named {
  roster: Pick<Roster, 'source' | 'participants' | 'count' | 'share' | 'shareBy'>;
  diff: PresenceReading;
  readAtMs: number;
}

/** The sharer the reading names by key, or the user. */
function sharerOf(
  presence: MeetingPresence,
  self: ParticipantRef,
  ids: ParticipantIds,
  people: readonly ParticipantRef[],
): ParticipantRef | null {
  const { share } = presence;
  if (share.kind !== 'active') return null;
  if (share.self) return self;
  const id = share.participantKey === null ? undefined : ids.byKey.get(share.participantKey);
  return people.find((person) => person.id === id) ?? null;
}

/**
 * `presence` by the notes' ids, read at `atMs`: the user first in the roster; where the page marks
 * the user, the diff counts them on a stage that does not show their own tile, as the page's count
 * does.
 */
function nameReading(
  presence: MeetingPresence,
  { ids, self, participants }: ReturnType<typeof assignParticipantIds>,
  capabilities: NotesCapabilities,
  atMs: number,
): Named {
  const others = participants.filter((person) => person.id !== self.id);
  const marked = participants.length > others.length || !capabilities.self;
  return {
    roster: {
      source: presence.source,
      participants: [self, ...others],
      count: presence.count,
      share: presence.share.kind,
      shareBy: sharerOf(presence, self, ids, participants),
    },
    diff: {
      source: presence.source,
      participants: marked ? participants : [self, ...others],
      count: presence.count,
    },
    readAtMs: atMs,
  };
}

/**
 * A roster event of `named` (none: only the user, nothing known), `stale` when the page no longer
 * shows the call it read; the start's says what the service can show at best.
 */
function rosterOf(
  why: Roster['why'],
  about: { named: Named | null; self: ParticipantRef; stale: boolean },
  capabilities: NotesCapabilities,
  atMs: number,
): Roster {
  const { named, self, stale } = about;
  const nothing: Named['roster'] = {
    source: null,
    participants: [self],
    count: null,
    share: 'unknown',
    shareBy: null,
  };
  return {
    type: 'roster',
    why,
    ...(named?.roster ?? nothing),
    stale: named !== null && stale,
    readAtMs: named?.readAtMs ?? atMs,
    capabilities: why === 'start' ? capabilities : null,
  };
}

export function createPresenceEvents<Stamp extends { atMs: number }>(options: {
  source: PresenceSource;
  /** The meeting the recording belongs to: its ids are the page's for that meeting. */
  meetingId: string | null;
  /** The ids of the page's meeting so far, which every recording of the page takes on. */
  ids: { current: ParticipantIds | null };
  /** Names are collected now. */
  names: () => boolean;
}) {
  const { source, ids } = options;
  const { capabilities } = source;
  let state: PresenceState<Stamp> | null = null;
  let last: Named | null = null;
  let unavailable = false;

  /** Reads the page now: the reading by the notes' ids, and the user; null without a call. */
  const read = (atMs: number): { named: Named | null; self: ParticipantRef } => {
    const presence = source.read();
    const people = presence?.participants ?? [];
    const assigned = assignParticipantIds(ids.current, options.meetingId, people);
    ids.current = assigned.ids;
    unavailable = presence === null;
    if (presence !== null) last = nameReading(presence, assigned, capabilities, atMs);
    return { named: presence === null ? null : last, self: assigned.self };
  };
  const roster = (why: Roster['why'], about: Parameters<typeof rosterOf>[1], stamp: Stamp) =>
    told(stamp, rosterOf(why, about, capabilities, stamp.atMs));
  const told = (stamp: Stamp, body: MeetingEventBody) => ({
    stamp,
    body: options.names() ? body : withoutParticipantNames(body),
  });
  const diff = (named: Named | null, stamp: Stamp, final = false) => {
    const result = diffPresence(state, named?.diff ?? null, stamp, final);
    state = result.state;
    return result.events.map((event) => told(event.stamp, event.body));
  };

  return {
    /** At the recording's start: who is in the call, what the service can show, and the baseline. */
    atStart(stamp: Stamp) {
      const { named, self } = read(stamp.atMs);
      return [roster('start', { named, self, stale: false }, stamp), ...diff(named, stamp)];
    },
    /** Once per tick while the recording runs or is paused. */
    observe(stamp: Stamp) {
      return diff(read(stamp.atMs).named, stamp);
    },
    /** Who is in the call again, from the last reading: for a new bridge. */
    reannounce(stamp: Stamp) {
      const { self } = assignParticipantIds(ids.current, options.meetingId, []);
      return [roster('reannounce', { named: last, self, stale: unavailable }, stamp)];
    },
    /** At the stop: what still waited, then who was there, from the last reading if none now. */
    atStop(stamp: Stamp) {
      const { named, self } = read(stamp.atMs);
      const events = diff(named, stamp, true);
      return [
        ...events,
        roster('stop', { named: named ?? last, self, stale: named === null }, stamp),
      ];
    },
  };
}
