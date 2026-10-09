/**
 * A presence reading without the names in it, for the debug output of test builds and whatever
 * logs carry it: a name becomes its length, a key (which can hold a name) a number in the order
 * the reading names it. Counts, kinds and states stay as they are, and no reading stays null.
 */
import type { MeetingPresence, MicState } from '@/lib/providers/types';

export interface RedactedPresence {
  participants: { key: string; name: number | null; self: boolean | null }[];
  source: MeetingPresence['source'];
  count: number | null;
  share:
    | { kind: 'none' }
    | { kind: 'unknown' }
    | { kind: 'active'; participantKey: string | null; name: number | null; self: boolean };
  selfMic: MicState | null;
}

export function redactPresence(presence: MeetingPresence | null): RedactedPresence | null {
  if (!presence) return null;
  const numbers = new Map<string, string>();
  const numberOf = (key: string): string => {
    const known = numbers.get(key);
    if (known) return known;
    const number = `p${numbers.size + 1}`;
    numbers.set(key, number);
    return number;
  };
  const length = (name: string | null) => (name === null ? null : name.length);
  const { share } = presence;
  return {
    participants: presence.participants.map(({ key, name, self }) => ({
      key: numberOf(key),
      name: length(name),
      self,
    })),
    source: presence.source,
    count: presence.count,
    share:
      share.kind === 'active'
        ? {
            ...share,
            participantKey: share.participantKey === null ? null : numberOf(share.participantKey),
            name: length(share.name),
          }
        : share,
    selfMic: presence.selfMic,
  };
}
