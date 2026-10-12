/**
 * Screen shares from one presence reading to the next, for the meeting notes: a share starting,
 * one ending, and one sharer after another as a stop and a start, by whom the page names. A share
 * is never a person. The first reading that shows shares is the baseline: a share already running
 * is in the start's reading, not an event. A page that never shows shares (`unknown` from the
 * start) writes nothing; one that stops showing them for a while (`unknown`, or no reading of the
 * call at all) loses the coverage of the shares until they show again, and what changed meanwhile
 * is told then. The user's own share is the recorder's to tell, from the browser itself
 * (`getDisplayMedia`): a reading's share by the user counts as none here, so it is never told twice.
 */
import type { MeetingEventBody, ParticipantRef } from '@/lib/types';

/** What one reading shows of the shares, the sharer by the notes' id. */
export type ShareReading =
  | { kind: 'none' }
  | { kind: 'unknown' }
  | { kind: 'active'; by: ParticipantRef | null };

type Known = Exclude<ShareReading, { kind: 'unknown' }>;

export interface ShareState {
  /** The share as last known; null while no reading showed shares. */
  known: Known | null;
  /** The last reading did not show the shares: their coverage is lost. */
  unavailable: boolean;
}

type Body = Extract<
  MeetingEventBody,
  { type: 'share-started' | 'share-stopped' | 'coverage-lost' | 'coverage-restored' }
>;

const UNAVAILABLE = { signal: 'share', reason: 'presence-unavailable' } as const;

/** A share by the user is the recorder's to tell: as none here. */
const othersOnly = (share: Known): Known =>
  share.kind === 'active' && share.by?.self === true ? { kind: 'none' } : share;

const same = (a: Known, b: Known): boolean =>
  a.kind === 'active' && b.kind === 'active' ? a.by?.id === b.by?.id : a.kind === b.kind;

/** The share events from `before` to `after`: a stop of the one before, a start of the new one. */
const changes = (before: Known, after: Known): Body[] => {
  if (same(before, after)) return [];
  return [
    ...(before.kind === 'active' ? [{ type: 'share-stopped' as const, by: before.by }] : []),
    ...(after.kind === 'active' ? [{ type: 'share-started' as const, by: after.by }] : []),
  ];
};

/**
 * The share events between the readings so far (`state`, null at a recording's start) and
 * `share`, seen at `stamp` (null: no reading of the call). `final` ends the recording: a last
 * reading without the call loses no coverage, as the stop's own reading says so.
 */
export function diffShare<Stamp>(
  state: ShareState | null,
  share: ShareReading | null,
  stamp: Stamp,
  final = false,
): { state: ShareState; events: { stamp: Stamp; body: Body }[] } {
  const before = state ?? { known: null, unavailable: false };
  const told = (bodies: Body[]) => bodies.map((body) => ({ stamp, body }));
  if (share === null || share.kind === 'unknown') {
    const lose = before.known !== null && !before.unavailable && !final;
    const events = told(lose ? [{ type: 'coverage-lost', ...UNAVAILABLE }] : []);
    return { state: { ...before, unavailable: before.known !== null }, events };
  }
  const after = othersOnly(share);
  const restored: Body[] = before.unavailable
    ? [{ type: 'coverage-restored', ...UNAVAILABLE }]
    : [];
  const events = told([...restored, ...(before.known ? changes(before.known, after) : [])]);
  return { state: { known: after, unavailable: false }, events };
}
