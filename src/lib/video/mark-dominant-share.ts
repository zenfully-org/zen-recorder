import type { VideoTile } from '@/lib/types';

/**
 * Flags the screen share for providers whose DOM does not label it: the one tile (never the self
 * view) at least twice as large on screen as the next largest. Returns new tiles.
 */
export function markDominantShare(tiles: VideoTile[]): VideoTile[] {
  const areas = tiles.map((tile) => (tile.isSelf ? 0 : tile.rect.width * tile.rect.height));
  const [largest = 0, second = 0] = [...areas].sort((a, b) => b - a);
  const dominant = tiles.length > 1 && largest > 0 && largest >= 2 * second;
  return tiles.map((tile, index) => ({ ...tile, isShare: dominant && areas[index] === largest }));
}
