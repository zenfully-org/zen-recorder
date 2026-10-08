import { describe, expect, it, vi } from 'vitest';
import { createByteBatcher } from './create-byte-batcher';
import type { EncodedChunk } from './create-media-recorder-encoder';

function setup() {
  vi.useFakeTimers();
  vi.setSystemTime(10_000);
  const chunks: EncodedChunk[] = [];
  const batcher = createByteBatcher({
    maxBytes: 100,
    maxMs: 3000,
    mimeType: 'video/webm',
    setTimeout: (handler, ms) => window.setTimeout(handler, ms),
    clearTimeout: (id) => window.clearTimeout(id),
    now: () => Date.now(),
    onChunk: (c) => chunks.push(c),
  });
  return { chunks, batcher };
}

const bytes = (n: number, fill = 1) => new Uint8Array(n).fill(fill);

describe('createByteBatcher', () => {
  it('emits when the size limit is reached, numbering chunks from 0', async () => {
    const { chunks, batcher } = setup();
    batcher.write(bytes(60));
    expect(chunks).toEqual([]);
    expect(batcher.bufferedBytes()).toBe(60);
    batcher.write(bytes(40, 2));
    expect(chunks.length).toBe(1);
    expect(chunks[0]).toMatchObject({ seq: 0, timestampMs: 0 });
    expect(chunks[0]?.blob.size).toBe(100);
    expect(chunks[0]?.blob.type).toBe('video/webm');
    expect(batcher.bufferedBytes()).toBe(0);
    vi.setSystemTime(15_000);
    batcher.write(bytes(100));
    expect(chunks[1]).toMatchObject({ seq: 1, timestampMs: 5000 });
  });

  it('emits after the time limit when the size limit is not reached', async () => {
    const { chunks, batcher } = setup();
    batcher.write(bytes(10));
    await vi.advanceTimersByTimeAsync(2999);
    batcher.write(bytes(10));
    expect(chunks).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(chunks.length).toBe(1);
    expect(chunks[0]?.blob.size).toBe(20);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(chunks.length).toBe(1);
  });

  it('keeps a private copy of the written bytes', async () => {
    const { chunks, batcher } = setup();
    const buffer = bytes(10, 7);
    batcher.write(buffer);
    buffer.fill(0);
    batcher.flush();
    const blob = (chunks[0] as EncodedChunk).blob;
    expect(new Uint8Array(await blob.arrayBuffer())[0]).toBe(7);
  });

  it('flush emits a partial batch and cancels the timer; an empty flush is a no-op', async () => {
    const { chunks, batcher } = setup();
    batcher.flush();
    batcher.write(bytes(5));
    batcher.flush();
    expect(chunks.length).toBe(1);
    await vi.advanceTimersByTimeAsync(5000);
    expect(chunks.length).toBe(1);
  });

  it('ignores empty writes', () => {
    const { chunks, batcher } = setup();
    batcher.write(new Uint8Array(0));
    batcher.flush();
    expect(chunks).toEqual([]);
  });

  it('close flushes once and drops later writes', () => {
    const { chunks, batcher } = setup();
    batcher.write(bytes(5));
    batcher.close();
    batcher.close();
    batcher.write(bytes(5));
    batcher.flush();
    expect(chunks.length).toBe(1);
  });
});
