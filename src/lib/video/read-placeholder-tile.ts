import type { VideoTile } from '@/lib/types';

export interface PlaceholderTileInput {
  id: string;
  /** What the page shows instead of video (an avatar, an empty tile): it gives the tile its rect. */
  element: Element;
  name: string | null;
  isSelf: boolean;
}

/**
 * Builds the tile of a participant the page shows without any video element (camera off). The
 * compositor draws it as an initials placeholder, so the recording keeps the page's layout.
 */
export function readPlaceholderTile(input: PlaceholderTileInput): VideoTile {
  const rect = input.element.getBoundingClientRect();
  return {
    id: input.id,
    source: null,
    rect: { x: rect.left, y: rect.top, width: rect.width, height: rect.height },
    name: input.name,
    isSelf: input.isSelf,
    isShare: false,
    sourceWidth: 0,
    sourceHeight: 0,
    frameKey: 0,
  };
}
