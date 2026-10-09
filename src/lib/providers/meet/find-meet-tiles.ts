/**
 * Finds Meet's video tiles in the page DOM. Selector chain (most durable first):
 *   [data-participant-id][data-tile-media-id] → [data-participant-id] → every <video>.
 * The tile↔participant binding is ephemeral in Meet, so nothing is cached: call it every frame.
 *
 * A tile whose camera is off has no video to draw: Meet's own tile then has no `<video>`, or one
 * laid out with no box. It stays as an initials placeholder at the tile's place, so a call with no
 * camera on still has its tiles. Outside Meet's tile containers, an element without a video is no
 * tile (the People panel's rows carry a participant id too).
 *
 * No tile is a screen share (`isShare` is false): no marker on Meet's page has been verified to
 * label a presentation. Guessing from tile sizes took a lone remote camera, larger than the self
 * view, for a share. The recording's layout follows the tiles' places on the page, so a
 * presentation is as large in the file as on screen whatever the flag says.
 */
import type { VideoTile } from '@/lib/types';
import { readPlaceholderTile } from '@/lib/video/read-placeholder-tile';
import { readVideoTile } from '@/lib/video/read-video-tile';

const SELF_LIGATURES = ['frame_person', 'visual_effects'];

interface Candidate {
  container: Element;
  video: HTMLVideoElement | null;
  id: string;
}

function fromContainers(root: ParentNode, selector: string, keepWithoutVideo = false): Candidate[] {
  return [...root.querySelectorAll(selector)].flatMap((container, index) => {
    const video = container.querySelector('video');
    const participant = container.getAttribute('data-participant-id');
    if (participant === null || (!video && !keepWithoutVideo)) return [];
    const media = container.getAttribute('data-tile-media-id');
    return [
      { container, video, id: media ? `${participant}/${media}` : `${participant}#${index}` },
    ];
  });
}

function fromVideos(root: ParentNode): Candidate[] {
  return [...root.querySelectorAll('video')].flatMap((video, index) => {
    const container = video.parentElement;
    if (!container || !(video.videoWidth > 0 && video.readyState >= 2 && !video.paused)) return [];
    return [{ container, video, id: `video-${index}` }];
  });
}

function readName(container: Element): string | null {
  const text = (container.querySelector('span.notranslate')?.textContent || '').trim();
  return text || null;
}

function isSelfTile(container: Element): boolean {
  const text = container.textContent || '';
  return SELF_LIGATURES.some((ligature) => text.includes(ligature));
}

function hasBox(element: Element): boolean {
  const { width, height } = element.getBoundingClientRect();
  return width > 0 && height > 0;
}

function readTile({ container, video, id }: Candidate): VideoTile {
  const tile = { id, name: readName(container), isSelf: isSelfTile(container) };
  return video && hasBox(video)
    ? readVideoTile({ ...tile, source: video })
    : readPlaceholderTile({ ...tile, element: container });
}

export function findMeetTiles(root: ParentNode): VideoTile[] {
  const candidates = fromContainers(root, '[data-participant-id][data-tile-media-id]', true);
  const chain =
    candidates.length > 0
      ? candidates
      : fromContainers(root, '[data-participant-id]').length > 0
        ? fromContainers(root, '[data-participant-id]')
        : fromVideos(root);
  return chain.map(readTile);
}
