/**
 * Who is in a Teams call and who shares, as its call screen shows them. Every stage tile names its
 * person in `data-tid` (the display name), and that name keys them: the tile's own id
 * (`data-acc-element-id`) is new each time Teams mounts it. Teams draws the "is speaking" outline
 * on every camera tile but the user's own, so the one tile without it is the user (bots have none
 * either: with two such tiles, nobody can be told). A share tile carries its sharer's name. The
 * People badge counts everyone, the user included. Nothing outside the call screen: the call may go
 * on off screen while the user reads the chat. Verified on saved pages and Teams' bundle.
 */
import { keyPeopleByName } from '@/lib/providers/key-people-by-name';
import { readTeamsCallScreen } from '@/lib/providers/teams/read-teams-call-screen';
import { readTeamsMicMuted } from '@/lib/providers/teams/read-teams-mic-muted';
import { readTeamsRosterCount } from '@/lib/providers/teams/read-teams-roster-count';
import type { MeetingPresence, MicState, ScreenShareState } from '@/lib/providers/types';

const CAMERA_TILE = '[data-stream-type="Video"][data-tid]';
const SHARE_TILE = '[data-stream-type="ScreenSharing"]';
const VOICE_OUTLINE = '[data-tid="voice-level-stream-outline"]';

const nameOf = (tile: Element): string | null => tile.getAttribute('data-tid')?.trim() || null;

function readPeople(root: ParentNode) {
  const tiles = [...root.querySelectorAll(CAMERA_TILE)].flatMap((tile) => {
    const name = nameOf(tile);
    return name === null ? [] : [{ name, outlined: tile.querySelector(VOICE_OUTLINE) !== null }];
  });
  const unoutlined = tiles.filter((tile) => !tile.outlined).length;
  return keyPeopleByName(
    tiles.map(({ name, outlined }) => ({
      name,
      // An outline proves someone else; its absence proves the user only on one tile.
      self: outlined ? false : unoutlined === 1 || null,
    })),
  );
}

function readShare(root: ParentNode, selfName: string | null): ScreenShareState {
  const tile = root.querySelector(SHARE_TILE);
  if (!tile) return { kind: 'none' };
  const name = nameOf(tile);
  return {
    kind: 'active',
    participantKey: name === null ? null : `name:${name}`,
    name,
    self: name !== null && name === selfName,
  };
}

function readMic(root: ParentNode): MicState | null {
  const muted = readTeamsMicMuted(root);
  if (muted === null) return null;
  return muted ? 'muted' : 'live';
}

export function readTeamsPresence(root: ParentNode): MeetingPresence | null {
  if (readTeamsCallScreen(root) !== 'call') return null;
  const people = readPeople(root);
  const roster = readTeamsRosterCount(root);
  return {
    participants: people.map(({ key, name, self }) => ({ key, name, self })),
    source: 'stage',
    // The user reads the page, so the call holds one person at least.
    count: roster === null ? null : Math.max(1, roster),
    share: readShare(root, people.find((person) => person.self === true)?.name ?? null),
    selfMic: readMic(root),
  };
}
