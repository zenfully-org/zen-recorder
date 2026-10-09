/**
 * Pure layout for the composited video: mirrors the page's on-screen tile geometry (so pinning,
 * spotlight and screen-share prominence come for free), scaled into a fixed-size canvas with
 * letterboxing. Falls back to a uniform grid when the geometry is unusable.
 */
import type { Box, VideoTile } from '@/lib/types';

export interface LayoutCell {
  tile: VideoTile;
  /** Source rect inside the video (cover-cropped to the destination aspect). Zero when no frame. */
  sx: number;
  sy: number;
  sw: number;
  sh: number;
  /** Destination rect on the canvas. */
  dx: number;
  dy: number;
  dw: number;
  dh: number;
}

export interface LayoutSize {
  width: number;
  height: number;
}

interface Placed {
  tile: VideoTile;
  dest: Box;
}

function clip(rect: Box, viewport: LayoutSize): Box | null {
  const x1 = Math.max(0, rect.x);
  const y1 = Math.max(0, rect.y);
  const x2 = Math.min(viewport.width, rect.x + rect.width);
  const y2 = Math.min(viewport.height, rect.y + rect.height);
  return x2 - x1 >= 1 && y2 - y1 >= 1 ? { x: x1, y: y1, width: x2 - x1, height: y2 - y1 } : null;
}

function sourceRect(tile: VideoTile, dest: Box): Pick<LayoutCell, 'sx' | 'sy' | 'sw' | 'sh'> {
  // The part of the source that is this tile: its own region, or all of it.
  const region = tile.crop ?? { x: 0, y: 0, width: tile.sourceWidth, height: tile.sourceHeight };
  const { width: vw, height: vh } = region;
  if (vw <= 0 || vh <= 0 || dest.width <= 0 || dest.height <= 0) {
    return { sx: 0, sy: 0, sw: 0, sh: 0 };
  }
  const destAspect = dest.width / dest.height;
  if (vw / vh > destAspect) {
    const sw = vh * destAspect;
    return { sx: region.x + (vw - sw) / 2, sy: region.y, sw, sh: vh };
  }
  const sh = vw / destAspect;
  return { sx: region.x, sy: region.y + (vh - sh) / 2, sw: vw, sh };
}

function toCell({ tile, dest }: Placed): LayoutCell {
  const dx = Math.round(dest.x);
  const dy = Math.round(dest.y);
  const dw = Math.round(dest.x + dest.width) - dx;
  const dh = Math.round(dest.y + dest.height) - dy;
  const source = sourceRect(tile, { x: dx, y: dy, width: dw, height: dh });
  return {
    tile,
    sx: Math.round(source.sx),
    sy: Math.round(source.sy),
    sw: Math.round(source.sw),
    sh: Math.round(source.sh),
    dx,
    dy,
    dw,
    dh,
  };
}

function mirrored(visible: { tile: VideoTile; rect: Box }[], canvas: LayoutSize): Placed[] {
  const minX = Math.min(...visible.map((v) => v.rect.x));
  const minY = Math.min(...visible.map((v) => v.rect.y));
  const maxX = Math.max(...visible.map((v) => v.rect.x + v.rect.width));
  const maxY = Math.max(...visible.map((v) => v.rect.y + v.rect.height));
  const scale = Math.min(canvas.width / (maxX - minX), canvas.height / (maxY - minY));
  const offsetX = (canvas.width - (maxX - minX) * scale) / 2;
  const offsetY = (canvas.height - (maxY - minY) * scale) / 2;
  return visible.map(({ tile, rect }) => ({
    tile,
    dest: {
      x: offsetX + (rect.x - minX) * scale,
      y: offsetY + (rect.y - minY) * scale,
      width: rect.width * scale,
      height: rect.height * scale,
    },
  }));
}

function grid(tiles: VideoTile[], canvas: LayoutSize): Placed[] {
  const cols = Math.ceil(Math.sqrt(tiles.length));
  const rows = Math.ceil(tiles.length / cols);
  const cellWidth = canvas.width / cols;
  const cellHeight = canvas.height / rows;
  return tiles.map((tile, index) => ({
    tile,
    dest: {
      x: (index % cols) * cellWidth,
      y: Math.floor(index / cols) * cellHeight,
      width: cellWidth,
      height: cellHeight,
    },
  }));
}

/**
 * Places the visible tiles on the canvas. Tiles outside the viewport are dropped; when none has a
 * usable on-screen rect, all tiles are arranged in a uniform grid instead. The cells keep the order
 * of `tiles`, which is the order they are drawn in: where two tiles overlap (a self view floating
 * over the stage), the one the page paints on top must come last.
 */
export function layoutTiles(
  tiles: VideoTile[],
  viewport: LayoutSize,
  canvas: LayoutSize,
): LayoutCell[] {
  if (tiles.length === 0) return [];
  const visible = tiles.flatMap((tile) => {
    const rect = clip(tile.rect, viewport);
    return rect ? [{ tile, rect }] : [];
  });
  const placed = visible.length > 0 ? mirrored(visible, canvas) : grid(tiles, canvas);
  return placed.map(toCell);
}
