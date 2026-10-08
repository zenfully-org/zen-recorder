/**
 * Finds the Zoom web client's video tiles. Zoom decodes video in WASM workers and paints every
 * participant of a `<video-player-container>` into ONE canvas in the container's open shadow root;
 * the light DOM only holds a `<video-player>` placeholder per participant, positioned where that
 * participant's picture is. A tile is therefore the placeholder's region of the shared canvas. A
 * participant with the camera off is an avatar element without any player.
 * Verified live in Firefox on 2026-10-01. Nothing is cached: call it per frame.
 */
import type { Box, TileSource, VideoTile } from '@/lib/types';
import { readPlaceholderTile } from '@/lib/video/read-placeholder-tile';
import { readVideoTile } from '@/lib/video/read-video-tile';

const CONTAINER = 'video-player-container';
const PLAYER = 'video-player';
const AVATAR = '.video-avatar__avatar';
/** The camera-off name, in the middle of the avatar. */
const AVATAR_NAME = '.video-avatar__avatar-name';
/** The name label of a camera tile (next to the mute icon). */
const FOOTER_NAME = '.video-avatar__avatar-footer span';
/** The viewer's side of a screen share. */
const SHARE = '#sharee-container';

interface Painted {
  source: TileSource;
  /** The player's region of a canvas it shares with other players; absent when it owns the source. */
  crop?: Box;
}

const onScreen = (rect: DOMRect): boolean => rect.width > 0 && rect.height > 0;

const textOf = (element: Element | null | undefined): string | null =>
  element?.textContent?.trim() || null;

/** The part of the canvas (in canvas pixels) that lies under the player, or null when none does. */
function regionOf(player: DOMRect, canvas: HTMLCanvasElement): Box | null {
  const on = canvas.getBoundingClientRect();
  if (!onScreen(on)) return null;
  const scaleX = canvas.width / on.width;
  const scaleY = canvas.height / on.height;
  const left = Math.max(0, Math.round((player.left - on.left) * scaleX));
  const top = Math.max(0, Math.round((player.top - on.top) * scaleY));
  const right = Math.min(canvas.width, Math.round((player.left + player.width - on.left) * scaleX));
  const bottom = Math.min(
    canvas.height,
    Math.round((player.top + player.height - on.top) * scaleY),
  );
  return right > left && bottom > top
    ? { x: left, y: top, width: right - left, height: bottom - top }
    : null;
}

/** What shows the player's picture: its region of the container's canvas, else its own element. */
function paintedBy(player: Element, rect: DOMRect): Painted | null {
  const shared = player.closest(CONTAINER)?.shadowRoot?.querySelector('canvas');
  if (shared) {
    const crop = regionOf(rect, shared);
    return crop ? { source: shared, crop } : null;
  }
  const own = player.querySelector('canvas') ?? player.querySelector('video');
  return own ? { source: own } : null;
}

function playerTiles(root: ParentNode, frameKey: number): VideoTile[] {
  const seen = new Map<string, number>();
  return [...root.querySelectorAll(PLAYER)].flatMap((player) => {
    const rect = player.getBoundingClientRect();
    const painted = onScreen(rect) ? paintedBy(player, rect) : null;
    if (!painted) return [];
    const base = player.getAttribute('node-id') || player.getAttribute('name') || 'player';
    const repeats = seen.get(base) ?? 0;
    seen.set(base, repeats + 1);
    // The name label sits next to the player's wrapper, inside the same frame.
    const frame = player.closest('[data-attr="video-item-container"]')?.parentElement;
    const tile = readVideoTile({
      id: repeats === 0 ? base : `${base}#${repeats}`,
      source: painted.source,
      name: textOf(frame?.querySelector(FOOTER_NAME)),
      isSelf: false,
      // A canvas has no frame clock of its own; a <video> keeps its `currentTime`.
      ...('videoWidth' in painted.source ? {} : { frameKey }),
      ...(painted.crop ? { crop: painted.crop } : {}),
    });
    return [
      {
        ...tile,
        rect: { x: rect.left, y: rect.top, width: rect.width, height: rect.height },
        isShare: player.closest(SHARE) !== null,
      },
    ];
  });
}

function avatarTiles(root: ParentNode): VideoTile[] {
  return [...root.querySelectorAll(AVATAR)]
    .filter(
      (avatar) =>
        // With the camera on, the avatar element only carries the name label over the player.
        !avatar.parentElement?.querySelector(PLAYER) && onScreen(avatar.getBoundingClientRect()),
    )
    .map((avatar, index) =>
      readPlaceholderTile({
        id: `avatar-${index}`,
        element: avatar,
        name:
          textOf(avatar.querySelector(AVATAR_NAME)) ?? textOf(avatar.querySelector(FOOTER_NAME)),
        isSelf: false,
      }),
    );
}

/**
 * @param frameKey changes whenever the canvases may have been repainted (a canvas cannot tell).
 */
export function findZoomTiles(root: ParentNode, frameKey: number): VideoTile[] {
  return [...playerTiles(root, frameKey), ...avatarTiles(root)];
}
