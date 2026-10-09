/**
 * Who is in a Meet call, as its stage shows them. Every tile container carries the participant's
 * id (`data-participant-id`), with a camera or without one, and that id keys the person: the media
 * slot (`data-tile-media-id`) is pooled and moves between people. Tiles of one id are one person (a
 * camera and a presentation). The user's tile is the one with the self view's controls (the
 * `frame_person` or `visual_effects` ligature). No marker on Meet's page has been verified to label
 * a presentation, so whether someone shares stays unknown, and the microphone is the track's own
 * state, which Meet disables when muting.
 */
import type { MeetingPresence, Participant } from '@/lib/providers/types';

const TILE = '[data-participant-id]';
const SELF_LIGATURES = ['frame_person', 'visual_effects'];

interface Seen {
  name: string | null;
  self: boolean;
}

const nameOf = (tile: Element): string | null =>
  tile.querySelector('span.notranslate')?.textContent?.trim() || null;

const showsSelfView = (tile: Element): boolean => {
  const text = tile.textContent || '';
  return SELF_LIGATURES.some((ligature) => text.includes(ligature));
};

export function readMeetPresence(root: ParentNode, count: number | null): MeetingPresence {
  const seen = new Map<string, Seen>();
  for (const tile of root.querySelectorAll(TILE)) {
    const key = tile.getAttribute('data-participant-id');
    // An empty id names nobody the next reading could find again.
    if (!key) continue;
    const before = seen.get(key);
    seen.set(key, {
      name: before?.name ?? nameOf(tile),
      self: (before?.self ?? false) || showsSelfView(tile),
    });
  }
  const userShown = [...seen.values()].some((person) => person.self);
  const participants: Participant[] = [...seen].map(([key, { name, self }]) => ({
    key,
    name,
    // Without a self view on the page, any tile may be the user's.
    self: self || (userShown ? false : null),
  }));
  return { participants, source: 'stage', count, share: { kind: 'unknown' }, selfMic: null };
}
