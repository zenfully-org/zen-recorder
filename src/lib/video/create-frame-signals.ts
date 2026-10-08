/**
 * Tells each tile's current frame apart, so the compositor can skip a tick when no tile has a new
 * frame. A MediaStream `<video>`'s `currentTime` moves without new frames, and Zoom's canvas has no
 * signal at all, so the providers' frame keys always change. `requestVideoFrameCallback` fires once
 * per new frame, but only while the page paints (it runs with the refresh driver, throttled in a
 * hidden, minimized or occluded tab). A one-at-a-time `requestAnimationFrame` probe tells whether
 * painting runs: while it does, a `<video>` tile is keyed by its frame count; otherwise every tile
 * keeps the provider's key and counts as changed, as before. The callback runs at the next refresh,
 * after the picture already changed, so a tile that got a frame in the last `ACTIVE_MS` also counts
 * as changed on every tick: moving pictures are drawn as before, only still ones are skipped.
 * Verified in Firefox 155.
 */
import type { VideoTile } from '@/lib/types';

export interface FrameSignalsDeps {
  requestAnimationFrame: (callback: (at: number) => void) => number;
  now: () => number;
}

export interface FrameSignals {
  /** Call once per tick; returns the frame key of a tile for this tick. */
  keys(): (tile: VideoTile) => number;
}

/** An animation frame must answer this fast… */
const PAINT_LATENCY_MS = 100;
/** …and the last one must be this recent for frame callbacks to be trusted. */
const PAINT_FRESH_MS = 250;
/** A tile with a frame this recent may already show the next one: draw it on every tick. */
const ACTIVE_MS = 150;

interface VideoState {
  frames: number;
  armed: boolean;
  lastFrameAt: number;
}

export function createFrameSignals(deps: FrameSignalsDeps): FrameSignals {
  const videos = new WeakMap<HTMLVideoElement, VideoState>();
  let requestedAt: number | null = null;
  let paintedAt: number | null = null;
  let healthy = false;

  const probe = (now: number): void => {
    if (requestedAt !== null) return;
    requestedAt = now;
    deps.requestAnimationFrame(() => {
      const answered = deps.now();
      healthy = answered - now <= PAINT_LATENCY_MS;
      paintedAt = answered;
      requestedAt = null;
    });
  };

  /** The element's frame count and last frame time; arms one callback at a time. */
  const stateOf = (video: HTMLVideoElement): VideoState => {
    const state = videos.get(video) ?? { frames: 0, armed: false, lastFrameAt: -Infinity };
    videos.set(video, state);
    if (!state.armed) {
      state.armed = true;
      video.requestVideoFrameCallback(() => {
        state.frames++;
        state.lastFrameAt = deps.now();
        state.armed = false;
      });
    }
    return state;
  };

  return {
    keys() {
      const now = deps.now();
      probe(now);
      const painting = healthy && paintedAt !== null && now - paintedAt <= PAINT_FRESH_MS;
      return (tile) => {
        const { source } = tile;
        if (!painting || !source || !('requestVideoFrameCallback' in source)) {
          return tile.frameKey;
        }
        const state = stateOf(source);
        return now - state.lastFrameAt < ACTIVE_MS ? tile.frameKey : state.frames;
      };
    },
  };
}
