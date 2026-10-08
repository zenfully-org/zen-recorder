/**
 * Chooses how a recording is remuxed given its size: small files go through memory (fast, simple),
 * large ones are streamed into an OPFS scratch file (the background page cannot hold a 1 GB
 * ArrayBuffer), and without OPFS a huge file is saved as-is rather than risking an OOM.
 */

export type FinalizeStrategy = 'buffer' | 'stream' | 'raw';

export interface FinalizeStrategyInput {
  byteSize: number;
  opfsAvailable: boolean;
  /** Files above this size use OPFS when available. */
  streamAboveBytes?: number;
  /** Largest file remuxed in memory when streaming is unavailable. */
  maxBufferBytes?: number;
}

const DEFAULT_STREAM_ABOVE = 64 * 1024 * 1024;
const DEFAULT_MAX_BUFFER = 400 * 1024 * 1024;

export function pickFinalizeStrategy(input: FinalizeStrategyInput): FinalizeStrategy {
  const streamAbove = input.streamAboveBytes ?? DEFAULT_STREAM_ABOVE;
  const maxBuffer = input.maxBufferBytes ?? DEFAULT_MAX_BUFFER;
  if (input.byteSize > streamAbove && input.opfsAvailable) return 'stream';
  return input.byteSize <= maxBuffer ? 'buffer' : 'raw';
}
