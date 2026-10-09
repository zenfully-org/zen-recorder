/**
 * Owns the composite canvas: finds the page's tiles (through the provider), lays them out and paints them, skipping the
 * draw when the frame signature is unchanged. Reports how long each step took (see `createFrameStats`).
 *
 * A `<canvas>` source is snapshotted once per frame and all its tiles are drawn from that snapshot:
 * drawing from a canvas a worker paints (Zoom) costs a full synchronous snapshot per `drawImage`,
 * so three crops cost three snapshots (measured on Firefox: 48-86 ms, against 10-18 ms from one
 * `createImageBitmap`). A snapshot that freezes the page (a busy worker) holds its canvas back:
 * its tiles are drawn as placeholders until the guard lets it be tried again (`createSnapshotGuard`).
 */
import type { TileSource, VideoTile } from '@/lib/types';
import { createSnapshotGuard, type SnapshotGuard } from '@/lib/video/create-snapshot-guard';
import type { Canvas2d, DrawOptions } from '@/lib/video/draw-composite-frame';
import type { LayoutCell, LayoutSize } from '@/lib/video/layout-tiles';

/** An image taken of a source for one frame, released once the frame is drawn. */
export interface SourceSnapshot {
  image: CanvasImageSource;
  close(): void;
}

export interface TileCompositorDeps {
  createCanvas: () => HTMLCanvasElement;
  size: LayoutSize;
  viewport: () => LayoutSize;
  labels: boolean;
  findTiles: () => VideoTile[];
  layout: (tiles: VideoTile[], viewport: LayoutSize, canvas: LayoutSize) => LayoutCell[];
  signature: (tiles: VideoTile[]) => string;
  draw: (ctx: Canvas2d, cells: LayoutCell[], options: DrawOptions) => void;
  /** Takes a snapshot of a canvas source (`createImageBitmap`); null when it cannot. */
  snapshot: (source: HTMLCanvasElement) => Promise<SourceSnapshot | null>;
  /** Called once per frame: how to tell each tile's current frame (see `createFrameSignals`). */
  frameKeys: () => (tile: VideoTile) => number;
  now: () => number;
  /** Lines for the diagnostics log (a canvas held back because its snapshots froze the page). */
  onLog?: (message: string) => void;
}

/** What one `drawFrame` did and how long its steps took (ms). */
export interface DrawResult {
  drawn: boolean;
  /** Finding the tiles and computing their signature. */
  findMs: number;
  layoutMs: number;
  /** Main-thread time of drawing, including the synchronous part of taking snapshots. */
  drawMs: number;
  /** Time spent waiting for snapshots to arrive (the main thread is free meanwhile). */
  snapshotWaitMs: number;
}

export interface TileCompositor {
  readonly canvas: HTMLCanvasElement;
  /** Draws a frame unless nothing changed (or always, when forced). */
  drawFrame(options?: { force?: boolean }): Promise<DrawResult>;
  tileCount(): number;
  framesDrawn(): number;
  dispose(): void;
}

const NOT_DRAWN: DrawResult = {
  drawn: false,
  findMs: 0,
  layoutMs: 0,
  drawMs: 0,
  snapshotWaitMs: 0,
};

/**
 * One snapshot per distinct canvas source among the cells, except the canvases the guard holds
 * back. The synchronous part of each call is how long it blocked the page.
 */
async function takeSnapshots(cells: LayoutCell[], deps: TileCompositorDeps, guard: SnapshotGuard) {
  const canvases = new Set<HTMLCanvasElement>();
  for (const { tile } of cells) {
    if (tile.source && !('videoWidth' in tile.source)) canvases.add(tile.source);
  }
  const at = deps.now();
  const held = new Set([...canvases].filter((source) => !guard.allows(source, at)));
  const taken = await Promise.all(
    [...canvases]
      .filter((source) => !held.has(source))
      .map((source) => {
        const before = deps.now();
        const pending = deps.snapshot(source);
        guard.blocked(source, deps.now() - before, before);
        return pending.then((snapshot) => [source, snapshot] as const);
      }),
  );
  const snapshots = taken.flatMap(([source, snapshot]) => (snapshot ? [{ source, snapshot }] : []));
  return { snapshots, held };
}

/** The cells, with the tiles of a canvas held back drawn as placeholders (no source). */
function withPlaceholders(cells: LayoutCell[], held: ReadonlySet<TileSource>): LayoutCell[] {
  if (held.size === 0) return cells;
  return cells.map((cell) =>
    cell.tile.source && held.has(cell.tile.source)
      ? { ...cell, tile: { ...cell.tile, source: null } }
      : cell,
  );
}

export function createTileCompositor(deps: TileCompositorDeps): TileCompositor {
  const canvas = deps.createCanvas();
  canvas.width = deps.size.width;
  canvas.height = deps.size.height;
  const ctx: Canvas2d | null = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas context unavailable');

  let lastSignature: string | null = null;
  let tiles = 0;
  let frames = 0;
  let disposed = false;
  const guard = createSnapshotGuard({ ...(deps.onLog ? { onLog: deps.onLog } : {}) });

  return {
    canvas,
    async drawFrame(options = {}) {
      if (disposed) return NOT_DRAWN;
      const started = deps.now();
      const keyOf = deps.frameKeys();
      const found = deps.findTiles().map((tile) => ({ ...tile, frameKey: keyOf(tile) }));
      tiles = found.length;
      const signature = deps.signature(found);
      const foundAt = deps.now();
      if (!options.force && signature === lastSignature) {
        return { ...NOT_DRAWN, findMs: foundAt - started };
      }
      const cells = deps.layout(found, deps.viewport(), deps.size);
      const laidOut = deps.now();
      const taking = takeSnapshots(cells, deps, guard);
      const requested = deps.now();
      const { snapshots, held } = await taking;
      const arrived = deps.now();
      if (disposed) {
        for (const { snapshot } of snapshots) snapshot.close();
        return NOT_DRAWN;
      }
      const images = new Map<TileSource, CanvasImageSource>(
        snapshots.map(({ source, snapshot }) => [source, snapshot.image]),
      );
      deps.draw(ctx, withPlaceholders(cells, held), { ...deps.size, labels: deps.labels, images });
      for (const { snapshot } of snapshots) snapshot.close();
      lastSignature = signature;
      frames++;
      return {
        drawn: true,
        findMs: foundAt - started,
        layoutMs: laidOut - foundAt,
        drawMs: requested - laidOut + (deps.now() - arrived),
        snapshotWaitMs: arrived - requested,
      };
    },
    tileCount: () => tiles,
    framesDrawn: () => frames,
    dispose() {
      disposed = true;
      canvas.width = 0;
      canvas.height = 0;
    },
  };
}
