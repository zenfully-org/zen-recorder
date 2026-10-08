import { afterEach, describe, expect, it, vi } from 'vitest';
import { type ChunkStore, openChunkStore } from '@/lib/storage/open-chunk-store';
import type { RecordingMeta } from '@/lib/types';
import { deleteStrayChunks } from './delete-stray-chunks';

const HOUR_MS = 60 * 60 * 1000;
const NOW = 100 * HOUR_MS;

let counter = 0;
let store: ChunkStore;

const putChunk = (recordingId: string, seq: number, receivedAt: number) =>
  store.putChunk({ recordingId, seq, blob: new Blob(['x']), byteLength: 1, receivedAt });

function failed(id: string): RecordingMeta {
  return {
    id,
    meetingCode: 'c',
    title: 't',
    startedAt: 1,
    mimeType: 'audio/webm',
    status: 'failed',
    chunkCount: 1,
    byteSize: 1,
  };
}

describe('deleteStrayChunks', () => {
  afterEach(async () => store.close());

  it('deletes the chunks of a recording never stored once none arrived for a day, and keeps all others', async () => {
    store = openChunkStore(`stray-${++counter}`);
    await putChunk('stray', 0, NOW - 30 * HOUR_MS);
    await putChunk('stray', 1, NOW - 25 * HOUR_MS);
    // The newest arrived less than a day ago: the page may still announce its recording.
    await putChunk('recent', 0, NOW - 30 * HOUR_MS);
    await putChunk('recent', 1, NOW - 23 * HOUR_MS);
    // A connected tab names it as its recording.
    await putChunk('claimed', 0, NOW - 30 * HOUR_MS);
    // A stored recording keeps its chunks however old they are: a failed save waits for a retry.
    await store.putRecording(failed('known'));
    await putChunk('known', 0, NOW - 30 * HOUR_MS);
    const warnings: unknown[][] = [];
    const deleted = await deleteStrayChunks({
      store,
      claimedIds: () => ['claimed'],
      now: () => NOW,
      warn: (...args) => warnings.push(args),
    });
    expect(deleted).toEqual(['stray']);
    expect(await store.countChunks('stray')).toBe(0);
    expect(await store.countChunks('recent')).toBe(2);
    expect(await store.countChunks('claimed')).toBe(1);
    expect(await store.countChunks('known')).toBe(1);
    expect(warnings).toEqual([
      ['deleted 2 chunks of stray: no recording was stored for them, and none arrived for 25 h'],
    ]);
  });

  it('uses the wall clock and keeps chunks for a day by default', async () => {
    store = openChunkStore(`stray-${++counter}`);
    await putChunk('old', 0, Date.now() - 25 * HOUR_MS);
    await putChunk('fresh', 0, Date.now() - 23 * HOUR_MS);
    const deleted = await deleteStrayChunks({
      store,
      claimedIds: () => [],
      warn: () => undefined,
    });
    expect(deleted).toEqual(['old']);
    expect(await store.countChunks('fresh')).toBe(1);
  });

  it('leaves a recording alone whose chunks are gone by the time it is read', async () => {
    store = openChunkStore(`stray-${++counter}`);
    await putChunk('removed', 0, NOW - 30 * HOUR_MS);
    // Removed from the popup between the listing and the read, chunks and metadata.
    vi.spyOn(store, 'getChunks').mockResolvedValueOnce([]);
    const warnings: unknown[][] = [];
    const deleted = await deleteStrayChunks({
      store,
      claimedIds: () => [],
      now: () => NOW,
      warn: (...args) => warnings.push(args),
    });
    expect(deleted).toEqual([]);
    expect(warnings).toEqual([]);
  });

  it('logs a recording whose chunks could not be deleted and goes on with the next', async () => {
    store = openChunkStore(`stray-${++counter}`);
    await putChunk('a', 0, NOW - 30 * HOUR_MS);
    await putChunk('b', 0, NOW - 30 * HOUR_MS);
    const failure = new DOMException('the database connection is closing', 'InvalidStateError');
    vi.spyOn(store, 'deleteChunks').mockRejectedValueOnce(failure);
    const warnings: unknown[][] = [];
    const deleted = await deleteStrayChunks({
      store,
      claimedIds: () => [],
      now: () => NOW,
      warn: (...args) => warnings.push(args),
    });
    expect(deleted).toEqual(['b']);
    expect(warnings).toEqual([
      ['could not delete the stray chunks of a:', failure],
      ['deleted 1 chunk of b: no recording was stored for them, and none arrived for 30 h'],
    ]);
    expect(await store.countChunks('a')).toBe(1);
  });

  it('logs a pass that could not list the chunks, and resolves', async () => {
    store = openChunkStore(`stray-${++counter}`);
    const failure = new Error('the database connection is closing');
    vi.spyOn(store, 'listRecordingIdsWithChunks').mockRejectedValueOnce(failure);
    const warnings: unknown[][] = [];
    const deleted = await deleteStrayChunks({
      store,
      claimedIds: () => [],
      warn: (...args) => warnings.push(args),
    });
    expect(deleted).toEqual([]);
    expect(warnings).toEqual([['could not list the stored chunks:', failure]]);
  });
});
