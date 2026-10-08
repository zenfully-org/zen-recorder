import type { VideoTile } from '@/lib/types';

/**
 * Cheap fingerprint of what a composite frame would show. Identical signatures mean the canvas
 * does not need to be redrawn (nothing moved, no new frames, no label change).
 */
export function computeFrameSignature(tiles: VideoTile[]): string {
  return tiles
    .map((t) => {
      const { x, y, width, height } = t.rect;
      const rect = [x, y, width, height].map(Math.round).join(',');
      const crop = t.crop ? [t.crop.x, t.crop.y, t.crop.width, t.crop.height].join(',') : '';
      return `${t.id}|${rect}|${t.frameKey}|${t.sourceWidth}x${t.sourceHeight}|${crop}|${t.name ?? ''}`;
    })
    .join(';');
}
