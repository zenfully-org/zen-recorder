/**
 * Finds Teams' video tiles. Every tile of the stage is a `[data-stream-type]` element ("Video" or
 * "ScreenSharing") whose `data-tid` is the participant's display name; it holds a `<video>`, or an
 * avatar while the camera is off. Its menu item (`[data-acc-element-id]`) tells tiles apart: a
 * person's camera and share tiles have the same name. Outside a call (pre-join preview, a call
 * shown some other way) every playing `<video>` is taken instead. Nothing is cached.
 */
import type { VideoTile } from '@/lib/types';
import { containBox } from '@/lib/video/contain-box';
import { findVideoElementTiles } from '@/lib/video/find-video-element-tiles';
import { readPlaceholderTile } from '@/lib/video/read-placeholder-tile';
import { readVideoTile } from '@/lib/video/read-video-tile';

const TILE_SELECTOR = '[data-stream-type]';
/** Teams renders the "is speaking" outline on every camera tile but the user's own. */
const VOICE_OUTLINE_SELECTOR = '[data-tid="voice-level-stream-outline"]';
const PREVIEW_VIDEO_SELECTOR = '[data-tid="prejoin-v2-video-preview"] video';

const isShareTile = (element: Element): boolean =>
  element.getAttribute('data-stream-type') === 'ScreenSharing';

function readVideo(
  input: { id: string; name: string | null; isSelf: boolean },
  video: HTMLVideoElement,
) {
  const tile = readVideoTile({ ...input, source: video });
  // A share is shown whole (letterboxed) inside its element; cameras fill theirs.
  if (video.style.objectFit !== 'contain') return tile;
  return { ...tile, rect: containBox(tile.rect, tile.sourceWidth, tile.sourceHeight) };
}

function readStage(elements: Element[]): VideoTile[] {
  const share = elements.find(isShareTile);
  const withoutOutline = elements.filter(
    (element) => !isShareTile(element) && !element.querySelector(VOICE_OUTLINE_SELECTOR),
  );
  // Bots have no outline either: only an unambiguous tile is called the user's own.
  const self = withoutOutline.length === 1 ? withoutOutline[0] : undefined;
  const taken = new Set<string>();
  return elements.map((element, index) => {
    const elementId = element.closest('[data-acc-element-id]')?.getAttribute('data-acc-element-id');
    const base = elementId || `${element.getAttribute('data-stream-type')}-${index}`;
    const id = taken.has(base) ? `${base}#${index}` : base;
    taken.add(id);
    const input = {
      id,
      name: element.getAttribute('data-tid')?.trim() || null,
      isSelf: element === self,
    };
    const video = element.querySelector('video');
    const tile = video ? readVideo(input, video) : readPlaceholderTile({ ...input, element });
    return { ...tile, isShare: element === share };
  });
}

export function findTeamsTiles(root: ParentNode): VideoTile[] {
  const stage = [...root.querySelectorAll(TILE_SELECTOR)];
  if (stage.length > 0) return readStage(stage);
  const previews = new Set<unknown>(root.querySelectorAll(PREVIEW_VIDEO_SELECTOR));
  return findVideoElementTiles(root).map((tile) => ({
    ...tile,
    isSelf: previews.has(tile.source),
  }));
}
