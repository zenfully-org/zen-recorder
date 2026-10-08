import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ChunkMessage, RecordingEndedInfo } from '@/lib/types';
import { createChunkSender } from './create-chunk-sender';

function chunk(seq: number): ChunkMessage {
  return { recordingId: 'r', seq, blob: new Blob([`c${seq}`]), timestampMs: seq * 1000 };
}

function ended(chunkCount: number): RecordingEndedInfo {
  return { recordingId: 'r', chunkCount, durationMs: chunkCount * 1000, reason: 'command' };
}

/** For the tests that never end the recording. */
const noEnd = async () => undefined;

describe('createChunkSender', () => {
  afterEach(() => vi.useRealTimers());

  it('delivers chunks in order, one at a time, and reports delivery', async () => {
    const sent: number[] = [];
    const delivered: number[] = [];
    const sender = createChunkSender({
      sendEnd: noEnd,
      send: async (c) => {
        sent.push(c.seq);
        await new Promise((r) => setTimeout(r, 1));
      },
      onDelivered: (c) => delivered.push(c.seq),
    });
    sender.enqueue(chunk(0));
    sender.enqueue(chunk(1));
    sender.enqueue(chunk(2));
    await sender.whenIdle();
    expect(sent).toEqual([0, 1, 2]);
    expect(delivered).toEqual([0, 1, 2]);
    expect(sender.delivered()).toBe(3);
    expect(sender.pending()).toBe(0);
  });

  it('retries a failed send without reordering', async () => {
    let attempts = 0;
    const sent: number[] = [];
    const sender = createChunkSender({
      sendEnd: noEnd,
      send: async (c) => {
        attempts++;
        if (attempts === 1) throw new Error('bridge down');
        if (attempts === 2) throw 'not an error';
        sent.push(c.seq);
      },
      retryDelayMs: 1,
    });
    sender.enqueue(chunk(0));
    sender.enqueue(chunk(1));
    await sender.whenIdle();
    expect(sent).toEqual([0, 1]);
    expect(attempts).toBe(4);
  });

  it('times out a hanging ack and retries', async () => {
    vi.useFakeTimers();
    let calls = 0;
    const sender = createChunkSender({
      sendEnd: noEnd,
      send: () =>
        new Promise((resolve) => {
          calls++;
          if (calls > 1) resolve(undefined);
        }),
      ackTimeoutMs: 100,
      retryDelayMs: 10,
    });
    sender.enqueue(chunk(0));
    await vi.advanceTimersByTimeAsync(150);
    expect(calls).toBe(2);
    await vi.advanceTimersByTimeAsync(10);
    expect(sender.delivered()).toBe(1);
  });

  it('keeps every chunk, however long the bridge stays away: none is dropped from the file', () => {
    const sender = createChunkSender({
      sendEnd: noEnd,
      send: () => new Promise(() => undefined),
      ackTimeoutMs: 100_000,
    });
    for (let seq = 0; seq <= 400; seq++) sender.enqueue(chunk(seq));
    expect(sender.pending()).toBe(401);
  });

  it('calls onFull once, when the chunks not acked yet first hold more bytes than the limit', () => {
    const full: unknown[] = [];
    const sender = createChunkSender({
      sendEnd: noEnd,
      send: () => new Promise(() => undefined),
      ackTimeoutMs: 100_000,
      maxPendingBytes: 10,
      onFull: (backlog) => full.push(backlog),
    });
    // Four bytes each: 'c0', 'c1', … padded.
    const sized = (seq: number) => ({ ...chunk(seq), blob: new Blob(['abcd']) });
    sender.enqueue(sized(0));
    sender.enqueue(sized(1));
    expect(sender.pendingBytes()).toBe(8);
    expect(full).toEqual([]);
    sender.enqueue(sized(2));
    expect(full).toMatchObject([{ bytes: 12, chunks: 3, spanMs: 2000, elsewhereBytes: 0 }]);
    sender.enqueue(sized(3));
    expect(full).toHaveLength(1);
    // Nothing is dropped: the chunks wait for the bridge, in order.
    expect(sender.pending()).toBe(4);
    expect(sender.pendingBytes()).toBe(16);
  });

  it('counts a chunk until it is acked', async () => {
    const acks: (() => void)[] = [];
    const sender = createChunkSender({
      sendEnd: noEnd,
      send: () => new Promise<void>((resolve) => acks.push(resolve)),
    });
    sender.enqueue({ ...chunk(0), blob: new Blob(['abc']) });
    sender.enqueue({ ...chunk(1), blob: new Blob(['abcde']) });
    expect(sender.pendingBytes()).toBe(8);
    acks.shift()?.();
    await vi.waitFor(() => expect(sender.pendingBytes()).toBe(5));
    acks.shift()?.();
    await sender.whenIdle();
    expect(sender.pendingBytes()).toBe(0);
  });

  it('holds 64 MiB of chunks by default before it is full', () => {
    const mebibyte = new Blob([new Uint8Array(2 ** 20)]);
    let full = 0;
    const sender = createChunkSender({
      sendEnd: noEnd,
      send: () => new Promise(() => undefined),
      ackTimeoutMs: 100_000,
      onFull: () => full++,
    });
    for (let seq = 0; seq < 64; seq++) sender.enqueue({ ...chunk(seq), blob: mebibyte });
    expect(full).toBe(0);
    sender.enqueue({ ...chunk(64), blob: mebibyte });
    expect(full).toBe(1);
  });

  it('is full without an onFull handler and keeps the chunks', () => {
    const sender = createChunkSender({
      sendEnd: noEnd,
      send: () => new Promise(() => undefined),
      ackTimeoutMs: 100_000,
      maxPendingBytes: 1,
    });
    sender.enqueue(chunk(0));
    sender.enqueue(chunk(1));
    expect(sender.pending()).toBe(2);
  });

  it('uses injected timer functions', async () => {
    const scheduled: number[] = [];
    const sender = createChunkSender({
      sendEnd: noEnd,
      send: async () => undefined,
      setTimeout: (handler, ms) => {
        scheduled.push(ms);
        return setTimeout(handler, 0);
      },
      clearTimeout: (id) => clearTimeout(id as number),
      ackTimeoutMs: 123,
    });
    sender.enqueue(chunk(0));
    await sender.whenIdle();
    expect(scheduled).toEqual([123]);
  });

  it('sends the end notice after every chunk, and again until it is acked', async () => {
    vi.useFakeTimers();
    const sent: string[] = [];
    const sender = createChunkSender({
      send: async (c) => {
        sent.push(`chunk ${c.seq}`);
      },
      sendEnd: async (info) => {
        sent.push(`end after ${info.chunkCount}`);
        // The first one finds the bridge's Port down (the event page restarting).
        if (sent.filter((s) => s.startsWith('end')).length === 1) throw new Error('not connected');
      },
      retryDelayMs: 10,
    });
    sender.enqueue(chunk(0));
    sender.enqueue(chunk(1));
    sender.end(ended(2));
    await vi.advanceTimersByTimeAsync(10);
    await sender.whenIdle();
    expect(sent).toEqual(['chunk 0', 'chunk 1', 'end after 2', 'end after 2']);
    // Acked: it is not sent again.
    await vi.advanceTimersByTimeAsync(60_000);
    expect(sent).toHaveLength(4);
    expect(sender.delivered()).toBe(2);
  });

  it('sends an end notice given once the chunks were delivered again when its ack hangs', async () => {
    vi.useFakeTimers();
    let attempts = 0;
    const sender = createChunkSender({
      send: async () => undefined,
      sendEnd: () =>
        new Promise((resolve) => {
          attempts++;
          if (attempts > 1) resolve(undefined);
        }),
      ackTimeoutMs: 100,
      retryDelayMs: 10,
    });
    sender.enqueue(chunk(0));
    await sender.whenIdle();
    sender.end(ended(1));
    const idle = sender.whenIdle();
    await vi.advanceTimersByTimeAsync(110);
    await idle;
    expect(attempts).toBe(2);
  });

  it('whenIdle resolves immediately when nothing was ever enqueued', async () => {
    const sender = createChunkSender({ sendEnd: noEnd, send: async () => undefined });
    await expect(sender.whenIdle()).resolves.toBeUndefined();
  });
});

describe("createChunkSender beside the page's other recordings", () => {
  it('is settled only once the background acked its end, so the page claims it until then', async () => {
    const acks: (() => void)[] = [];
    const sender = createChunkSender({
      send: () => new Promise<void>((resolve) => acks.push(resolve)),
      sendEnd: () => new Promise<void>((resolve) => acks.push(resolve)),
    });
    sender.enqueue(chunk(0));
    acks.shift()?.();
    await vi.waitFor(() => expect(sender.pending()).toBe(0));
    // Every chunk is acked, but the recording has not ended yet.
    expect(sender.settled()).toBe(false);
    sender.end(ended(1));
    await vi.waitFor(() => expect(acks).toHaveLength(1));
    expect(sender.settled()).toBe(false);
    acks.shift()?.();
    await sender.whenIdle();
    expect(sender.settled()).toBe(true);
  });

  it('counts the bytes the page still holds for its other recordings toward the limit', () => {
    const full: unknown[] = [];
    let elsewhere = 6;
    const sender = createChunkSender({
      sendEnd: noEnd,
      send: () => new Promise(() => undefined),
      ackTimeoutMs: 100_000,
      maxPendingBytes: 10,
      pendingElsewhere: () => elsewhere,
      onFull: (backlog) => full.push(backlog),
    });
    const sized = (seq: number) => ({ ...chunk(seq), blob: new Blob(['abcd']) });
    sender.enqueue(sized(0));
    expect(full).toEqual([]);
    // The other recordings' chunks were partly taken meanwhile: what they hold now is what counts.
    elsewhere = 3;
    sender.enqueue(sized(1));
    expect(full).toEqual([
      { bytes: 8, chunks: 2, spanMs: 1000, elsewhereBytes: 3, limitBytes: 10 },
    ]);
    expect(sender.pendingBytes()).toBe(8);
  });
});
