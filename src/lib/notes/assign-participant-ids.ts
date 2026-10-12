/**
 * The notes' own ids for the people of one meeting: `p1`, `p2`, … in the order they are first
 * seen, the user first, never the service's ids, which are personal identifiers. The same key
 * keeps its id (across a rename, when the key survives it). A new key showing exactly the name of
 * someone the reading does not show any more is that person back (a rejoin, a device switch): the
 * same id, marked a guess (`display-name`), because a reader asking what someone did in the
 * meeting needs one person across a rejoin more than they lose by the rare wrong merge of two
 * people of one name. Two people shown at once with one name keep two ids, and nobody is merged
 * into the user by name. Keys a page builds from names (`name:…`) are guesses too.
 */
import type { Participant } from '@/lib/providers/types';
import type { ParticipantRef } from '@/lib/types';

/** The ids of one meeting so far. A new meeting starts again from `p1`. */
export interface ParticipantIds {
  meetingId: string | null;
  /** The page's key of each person (the user under a key of their own) and the id it has. */
  byKey: ReadonlyMap<string, string>;
  /** Each id's last name shown, for a rejoin. */
  names: ReadonlyMap<string, string>;
  /** Ids that joined appearances by name. */
  byName: ReadonlySet<string>;
}

/** The user's own key, which no page key can be: page keys are ids or `name:…`. */
const SELF_KEY = '\u0000self';
const SELF_ID = 'p1';
const NAME_KEY = 'name:';

const fresh = (meetingId: string | null): ParticipantIds => ({
  meetingId,
  byKey: new Map([[SELF_KEY, SELF_ID]]),
  names: new Map(),
  byName: new Set(),
});

/** Someone of `name` the reading shows under no other key, never the user: who a new key may be. */
function rejoinOf(
  names: ReadonlyMap<string, string>,
  name: string | null,
  shown: ReadonlySet<string>,
): string | undefined {
  if (name === null) return undefined;
  for (const [id, last] of names) if (last === name && id !== SELF_ID && !shown.has(id)) return id;
  return undefined;
}

/**
 * Ids for the people of `reading`, in its order, each once, and the user's own participant, from
 * the ids of the meeting so far (`ids`, null at the start of a page session). The person the
 * reading marks as the user is the user's participant. Returns the meeting's ids with the new
 * people in them, and leaves `ids` as it was.
 */
export function assignParticipantIds(
  ids: ParticipantIds | null,
  meetingId: string | null,
  reading: readonly Participant[],
): { ids: ParticipantIds; self: ParticipantRef; participants: ParticipantRef[] } {
  const known = ids !== null && ids.meetingId === meetingId ? ids : fresh(meetingId);
  const byKey = new Map(known.byKey);
  const names = new Map(known.names);
  const byName = new Set(known.byName);
  const keyOf = (person: Participant) => (person.self === true ? SELF_KEY : person.key);
  // Known keys first, so a new key never takes the id of someone shown under theirs.
  const shown = new Set(reading.flatMap((person) => byKey.get(keyOf(person)) ?? []));
  const idOf = (person: Participant): string => {
    const key = keyOf(person);
    const known = byKey.get(key);
    if (known !== undefined) return known;
    const rejoin = rejoinOf(names, person.name, shown);
    const id = rejoin ?? `p${new Set(byKey.values()).size + 1}`;
    if (rejoin !== undefined || key.startsWith(NAME_KEY)) byName.add(id);
    byKey.set(key, id);
    shown.add(id);
    return id;
  };
  const listed = new Set<string>();
  const participants: ParticipantRef[] = [];
  for (const person of reading) {
    const id = idOf(person);
    if (person.name !== null) names.set(id, person.name);
    if (listed.has(id)) continue;
    listed.add(id);
    const identity = byName.has(id) ? 'display-name' : 'service-id';
    participants.push({ id, name: person.name, self: person.self, identity });
  }
  const self: ParticipantRef = {
    id: SELF_ID,
    name: names.get(SELF_ID) ?? null,
    self: true,
    identity: 'service-id',
  };
  return { ids: { meetingId, byKey, names, byName }, self, participants };
}
