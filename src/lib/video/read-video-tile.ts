import type { Box, TileSource, VideoTile } from '@/lib/types';

export interface VideoTileInput {
  id: string;
  source: TileSource;
  name: string | null;
  isSelf: boolean;
  /**
   * What tells one frame of the source from the next. Defaults to `currentTime` for a `<video>`; a
   * `<canvas>` has no such signal, so pass a value that changes whenever it may have been redrawn.
   */
  frameKey?: number;
  /** The tile's own region of a source it shares with other tiles (source pixels). */
  crop?: Box;
}

/**
 * Builds a `VideoTile` from an element the provider found: its on-screen rect, intrinsic size and
 * frame key. Shared by every provider so tiles are measured the same way.
 */
export function readVideoTile(input: VideoTileInput): VideoTile {
  const { source } = input;
  const rect = source.getBoundingClientRect();
  const media =
    'videoWidth' in source
      ? { width: source.videoWidth, height: source.videoHeight, frameKey: source.currentTime }
      : { width: source.width, height: source.height, frameKey: 0 };
  return {
    id: input.id,
    source,
    rect: { x: rect.left, y: rect.top, width: rect.width, height: rect.height },
    name: input.name,
    isSelf: input.isSelf,
    isShare: false,
    sourceWidth: media.width,
    sourceHeight: media.height,
    frameKey: input.frameKey ?? media.frameKey,
    ...(input.crop ? { crop: input.crop } : {}),
  };
}
