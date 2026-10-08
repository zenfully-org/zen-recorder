import type { VideoTile } from '@/lib/types';
import { readVideoTile } from '@/lib/video/read-video-tile';

/**
 * The provider-agnostic fallback: every `<video>` that is playing and has a frame becomes a tile
 * (no names, no self/share detection). Providers use it when their own selectors find nothing.
 */
export function findVideoElementTiles(root: ParentNode): VideoTile[] {
  return [...root.querySelectorAll('video')].flatMap((video, index) =>
    video.videoWidth > 0 && video.readyState >= 2 && !video.paused
      ? [readVideoTile({ id: `video-${index}`, source: video, name: null, isSelf: false })]
      : [],
  );
}
