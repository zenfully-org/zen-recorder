/**
 * Turns the muxer's sequential byte writes into recorder chunks: a chunk is emitted when the buffer
 * reaches `maxBytes`, when `maxMs` has elapsed since the first buffered byte, or on `flush()`.
 */
import type { EncodedChunk } from '@/lib/page/create-media-recorder-encoder';

export interface ByteBatcherDeps {
  maxBytes: number;
  maxMs: number;
  mimeType: string;
  setTimeout: (handler: () => void, ms: number) => number;
  clearTimeout: (id: number) => void;
  now: () => number;
  onChunk: (chunk: EncodedChunk) => void;
}

export interface ByteBatcher {
  write(bytes: Uint8Array): void;
  /** Emits whatever is buffered right now (no-op when empty). */
  flush(): void;
  /** Flushes and cancels the timer; further writes are ignored. */
  close(): void;
  bufferedBytes(): number;
}

export function createByteBatcher(deps: ByteBatcherDeps): ByteBatcher {
  const startedAt = deps.now();
  let parts: Uint8Array<ArrayBuffer>[] = [];
  let buffered = 0;
  let seq = 0;
  let timer: number | null = null;
  let closed = false;

  const flush = (): void => {
    if (timer !== null) {
      deps.clearTimeout(timer);
      timer = null;
    }
    if (buffered === 0) return;
    const blob = new Blob(parts, { type: deps.mimeType });
    parts = [];
    buffered = 0;
    deps.onChunk({ seq: seq++, blob, timestampMs: Math.round(deps.now() - startedAt) });
  };

  return {
    write(bytes) {
      if (closed || bytes.length === 0) return;
      // The muxer may reuse its buffers, so keep a private copy.
      parts.push(bytes.slice());
      buffered += bytes.length;
      if (buffered >= deps.maxBytes) {
        flush();
        return;
      }
      timer ??= deps.setTimeout(flush, deps.maxMs);
    },
    flush,
    close() {
      if (closed) return;
      flush();
      closed = true;
    },
    bufferedBytes: () => buffered,
  };
}
