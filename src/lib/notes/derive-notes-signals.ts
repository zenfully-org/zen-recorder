import type { MeetingNotesDocument, NotesEvent } from '@/lib/notes/parse-meeting-notes';

type Capture = MeetingNotesDocument['capture'];
type Signal = Capture['signals']['mic'];
type Roster = Extract<NotesEvent, { type: 'roster' }>;
type Capabilities = NonNullable<Roster['capabilities']>;

const NOT_AVAILABLE: Signal = 'not-available';
const observed = (yes: boolean | undefined): Signal => (yes === true ? 'observed' : NOT_AVAILABLE);

/** People: a full roster sees everyone, the stage only who is on screen. */
const PEOPLE: Readonly<Record<Capture['participantSource'], Signal>> = {
  roster: 'observed',
  mixed: 'observed',
  stage: 'partial',
  none: NOT_AVAILABLE,
};

const sourceOf = (rosters: readonly Roster[]): Capture['participantSource'] => {
  const sources = new Set(rosters.flatMap((roster) => roster.participantSource ?? []));
  const [only] = sources;
  return sources.size === 2 ? 'mixed' : (only ?? 'none');
};

/** Joins and leaves need a full roster or a count to match against; without them, a part. */
const joinsFrom = (can: Capabilities | undefined, source: Capture['participantSource']): Signal => {
  if (can === undefined || source === 'none') return NOT_AVAILABLE;
  return can.roster || can.count ? 'observed' : 'partial';
};

/**
 * What the file could observe, per signal, and where its participants came from: from what the
 * provider can tell at best (the start roster's capabilities) and the readings this file got. A
 * stage reading sees only who is on screen (`partial`); joins and leaves need a full roster or a
 * count to match against. Without a start roster nothing about people is known.
 */
export function deriveNotesSignals(
  events: readonly NotesEvent[],
): Pick<Capture, 'participantSource' | 'signals'> {
  const rosters = events.filter((event): event is Roster => event.type === 'roster');
  const can = rosters.find((roster) => roster.why === 'start')?.capabilities ?? undefined;
  const micSeen = events.some(
    (event) => event.type === 'mic' || (event.type === 'recording-started' && event.mic !== null),
  );
  const participantSource = sourceOf(rosters);
  return {
    participantSource,
    signals: {
      participants: PEOPLE[participantSource],
      joinLeave: joinsFrom(can, participantSource),
      share: observed(can?.share),
      shareBy: observed(can?.shareBy),
      self: observed(can?.self),
      mic: micSeen ? 'observed' : NOT_AVAILABLE,
    },
  };
}
