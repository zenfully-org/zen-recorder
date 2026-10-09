/**
 * Who is in a Zoom call and who shares, as the web client's stage shows it. Zoom marks no tile as
 * the user's own, and a tile carries the person's user id (`node-id`) only while their camera is
 * on, so people are keyed by display name: switching the camera keeps the key. The speaker view's
 * large tile is a slot (`node-id="1"`) showing whoever speaks, a person of its own only when no
 * other tile shows that name. A remote share is the share container's player
 * (`media-type="share"`), whose `node-id` is one of the sharer's stream ids: Zoom's client takes
 * the user id from it with `nodeId >> 10 << 10`, a different low part being another stream of the
 * same person (not checked live). Attributes and text only, verified live on 2026-10-01 but for
 * that low part.
 */
import { keyPeopleByName } from '@/lib/providers/key-people-by-name';
import type { MeetingPresence, Participant, ScreenShareState } from '@/lib/providers/types';
import type { ZoomDomHints } from '@/lib/providers/zoom/read-zoom-dom-hints';

/** Every participant tile has one, camera on or off: it holds the name. */
const STAGE_AVATAR = '.main-layout .video-avatar__avatar';
/** The camera-off name, in the middle of the avatar. */
const AVATAR_NAME = '.video-avatar__avatar-name';
/** The name label of a camera tile (next to the mute icon). */
const FOOTER_NAME = '.video-avatar__avatar-footer span';
const CAMERA = 'video-player[media-type="video"]';
const SHARE = '#sharee-container video-player[name="share-content"][media-type="share"]';
const SPEAKER_SLOT = '1';
const STREAM_ID_RE = /^\d+$/;
/** The stream ids of one person differ in their low ten bits. */
const STREAMS_PER_USER = 1024;

interface StageTile {
  name: string;
  /** The user id of a camera tile; null for an avatar and for the speaker slot. */
  userId: string | null;
  slot: boolean;
}

const textOf = (element: Element | null): string | null => element?.textContent?.trim() || null;

function readStage(root: ParentNode): StageTile[] {
  return [...root.querySelectorAll(STAGE_AVATAR)].flatMap((avatar) => {
    const name =
      textOf(avatar.querySelector(AVATAR_NAME)) ?? textOf(avatar.querySelector(FOOTER_NAME));
    if (name === null) return [];
    const nodeId = avatar.parentElement?.querySelector(CAMERA)?.getAttribute('node-id') ?? '';
    const slot = nodeId === SPEAKER_SLOT;
    const userId = STREAM_ID_RE.test(nodeId) && !slot ? nodeId : null;
    return [{ name, userId, slot }];
  });
}

type Person = StageTile & { key: string };

/** The people on the stage, the speaker slot only when no other tile shows its name. */
function readPeople(root: ParentNode): Person[] {
  const tiles = readStage(root);
  const named = new Set(tiles.filter((tile) => !tile.slot).map((tile) => tile.name));
  return keyPeopleByName(tiles.filter((tile) => !tile.slot || !named.has(tile.name)));
}

function readShare(root: ParentNode, people: Person[]): ScreenShareState {
  const share = root.querySelector(SHARE);
  if (!share) return { kind: 'none' };
  const streamId = share.getAttribute('node-id') ?? '';
  const userId = STREAM_ID_RE.test(streamId)
    ? String(Math.floor(Number(streamId) / STREAMS_PER_USER) * STREAMS_PER_USER)
    : null;
  const sharer = people.find((person) => person.userId !== null && person.userId === userId);
  return {
    kind: 'active',
    participantKey: sharer?.key ?? null,
    name: sharer?.name ?? null,
    self: false,
  };
}

export function readZoomPresence(
  root: ParentNode,
  hints: Pick<ZoomDomHints, 'participants' | 'mic'>,
): MeetingPresence {
  const people = readPeople(root);
  const participants: Participant[] = people.map(({ key, name }) => ({ key, name, self: null }));
  return {
    participants,
    source: 'stage',
    // The user reads the page, so the meeting holds one person at least.
    count: hints.participants === null ? null : Math.max(1, hints.participants),
    share: readShare(root, people),
    selfMic: hints.mic,
  };
}
