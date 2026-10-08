/**
 * Paints one composite frame: background, every tile (cover-cropped video or an initials
 * placeholder when the camera is off) and optional name labels.
 */
import type { TileSource } from '@/lib/types';
import type { LayoutCell } from '@/lib/video/layout-tiles';

/** The subset of CanvasRenderingContext2D the compositor uses (kept small so tests can fake it). */
export interface Canvas2d {
  fillStyle: string | CanvasGradient | CanvasPattern;
  font: string;
  textBaseline: CanvasTextBaseline;
  textAlign: CanvasTextAlign;
  fillRect(x: number, y: number, w: number, h: number): void;
  drawImage(
    image: CanvasImageSource,
    sx: number,
    sy: number,
    sw: number,
    sh: number,
    dx: number,
    dy: number,
    dw: number,
    dh: number,
  ): void;
  fillText(text: string, x: number, y: number): void;
  measureText(text: string): { width: number };
}

export interface DrawOptions {
  width: number;
  height: number;
  labels: boolean;
  /**
   * Snapshots taken of sources for this frame, drawn instead of the source itself (a canvas that a
   * worker paints costs a full snapshot per `drawImage`, so its crops share one).
   */
  images?: ReadonlyMap<TileSource, CanvasImageSource>;
}

const BACKGROUND = '#202124';
const PLACEHOLDER = '#3c4043';
const LABEL_BACKGROUND = 'rgba(0, 0, 0, 0.6)';
const TEXT = '#ffffff';
const MIN_LABEL_HEIGHT = 60;
const MIN_PLACEHOLDER_HEIGHT = 40;

function initials(name: string | null): string {
  const letters = (name ?? '')
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0));
  const [first = '', ...rest] = letters;
  if (!first) return '?';
  return (first + (rest.at(-1) ?? '')).toUpperCase();
}

function drawPlaceholder(ctx: Canvas2d, cell: LayoutCell): void {
  ctx.fillStyle = PLACEHOLDER;
  ctx.fillRect(cell.dx, cell.dy, cell.dw, cell.dh);
  if (cell.dh < MIN_PLACEHOLDER_HEIGHT) return;
  const size = Math.round(Math.min(cell.dw, cell.dh) / 3);
  ctx.fillStyle = TEXT;
  ctx.font = `${size}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(initials(cell.tile.name), cell.dx + cell.dw / 2, cell.dy + cell.dh / 2);
}

function drawLabel(ctx: Canvas2d, cell: LayoutCell, name: string): void {
  const size = Math.max(14, Math.round(cell.dh / 18));
  const padding = Math.round(size / 2);
  ctx.font = `${size}px sans-serif`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  const width = ctx.measureText(name).width + padding * 2;
  const height = size + padding;
  const x = cell.dx + padding;
  const y = cell.dy + cell.dh - padding - height;
  ctx.fillStyle = LABEL_BACKGROUND;
  ctx.fillRect(x, y, width, height);
  ctx.fillStyle = TEXT;
  ctx.fillText(name, x + padding, y + height / 2);
}

export function drawCompositeFrame(ctx: Canvas2d, cells: LayoutCell[], options: DrawOptions): void {
  ctx.fillStyle = BACKGROUND;
  ctx.fillRect(0, 0, options.width, options.height);
  if (cells.length === 0) {
    ctx.fillStyle = TEXT;
    ctx.font = `${Math.round(options.height / 20)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('No video tiles', options.width / 2, options.height / 2);
    return;
  }
  for (const cell of cells) {
    const { source } = cell.tile;
    if (source && cell.sw > 0 && cell.sh > 0) {
      const image = options.images?.get(source) ?? source;
      ctx.drawImage(image, cell.sx, cell.sy, cell.sw, cell.sh, cell.dx, cell.dy, cell.dw, cell.dh);
    } else {
      drawPlaceholder(ctx, cell);
    }
    if (options.labels && cell.tile.name && cell.dh >= MIN_LABEL_HEIGHT) {
      drawLabel(ctx, cell, cell.tile.name);
    }
  }
}
