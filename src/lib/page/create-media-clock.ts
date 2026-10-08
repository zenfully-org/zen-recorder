/**
 * The recording's timeline: where in the file each audio buffer goes, and where this
 * moment goes (for video frames, and for anything stamped with a media time). The file follows the
 * audio graph's clock: a buffer goes where the graph captured it, right after the one before it,
 * however late the page gets it, so neither a busy page nor the device clock's drift adds silence.
 * Silence goes only where the graph captured nothing: before the first buffer, where the graph
 * stood still (measured by `GraphClock` against the wall clock, and cut into the buffer at that
 * graph time) and where buffers are missing.
 *
 * A pause cuts its span out of the file: the clock stands still at the pause and goes on from
 * there at the resume. Audio from before the resume that the page gets after it still goes in,
 * back to back, without moving the clock.
 */
import type { GraphClock, GraphStop } from '@/lib/page/create-graph-clock';

export interface MediaClockDeps {
  graph: GraphClock;
}

/** A buffer from the audio tap: its first sample's graph frame and its length. */
export interface PlacedBuffer {
  frame: number;
  frames: number;
  sampleRate: number;
}

/** Silence to write `offset` frames into a buffer (0: before it). */
export interface AudioGap {
  offset: number;
  seconds: number;
}

export interface MediaClock {
  /** Seconds into the file of this moment; it stands still while paused. */
  now(): number;
  /**
   * The silence to write with `buffer`, in buffer order, with `written` seconds of audio in the
   * file so far; the clock then counts the buffer and its silence as written.
   */
  place(buffer: PlacedBuffer, written: number): AudioGap[];
  pause(): void;
  resume(): void;
}

export function createMediaClock(deps: MediaClockDeps): MediaClock {
  const { graph } = deps;
  /** Graph time `graph` is `file` seconds into the file. */
  let anchor = { file: 0, graph: graph.read() };
  /** Stops of the graph after the anchor, not in the file yet. */
  let pending: GraphStop[] = [];
  let pausedAt: number | null = null;

  const pendingSeconds = (): number => pending.reduce((sum, stop) => sum + stop.seconds, 0);

  /** The graph time now, with the stops measured meanwhile taken in. */
  const readGraph = (): number => {
    const now = graph.read();
    pending = [...pending, ...graph.takeStops()];
    return now;
  };

  const now = (): number => {
    if (pausedAt !== null) return pausedAt;
    return anchor.file + (readGraph() - anchor.graph) + pendingSeconds();
  };

  return {
    now,
    place(buffer, written) {
      readGraph();
      const { sampleRate } = buffer;
      const start = buffer.frame / sampleRate;
      const end = (buffer.frame + buffer.frames) / sampleRate;
      if (end <= anchor.graph) return [];
      const before = pending.filter((stop) => stop.at <= start);
      const inside = pending.filter((stop) => stop.at > start && stop.at < end);
      pending = pending.filter((stop) => stop.at >= end);
      const lead =
        anchor.file +
        (start - anchor.graph) +
        before.reduce((sum, stop) => sum + stop.seconds, 0) -
        written;
      const gaps = [
        ...(lead > 0 ? [{ offset: 0, seconds: lead }] : []),
        ...inside.map((stop) => ({
          offset: Math.round((stop.at - start) * sampleRate),
          seconds: stop.seconds,
        })),
      ];
      const silence = gaps.reduce((sum, gap) => sum + gap.seconds, 0);
      anchor = { file: written + silence + buffer.frames / sampleRate, graph: end };
      return gaps;
    },
    pause() {
      if (pausedAt === null) pausedAt = now();
    },
    resume() {
      if (pausedAt === null) return;
      const graphNow = graph.read();
      graph.takeStops();
      anchor = { file: pausedAt, graph: graphNow };
      pending = [];
      pausedAt = null;
    },
  };
}
