import { afterEach, describe, expect, it } from 'vitest';
import type { RecordingMeta } from '@/lib/types';
import { type ChunkStore, openChunkStore } from './open-chunk-store';

function meta(id: string, startedAt: number): RecordingMeta {
  return {
    id,
    meetingCode: 'abc-defg-hij',
    title: 't',
    startedAt,
    mimeType: 'audio/webm',
    status: 'recording',
    chunkCount: 0,
    byteSize: 0,
  };
}

let counter = 0;
let store: ChunkStore;

describe('openChunkStore', () => {
  afterEach(async () => store.close());

  it('stores, updates, lists (newest first) and deletes recordings', async () => {
    store = openChunkStore(`test-${++counter}`);
    await store.putRecording(meta('a', 1));
    await store.putRecording(meta('b', 2));
    expect((await store.listRecordings()).map((m) => m.id)).toEqual(['b', 'a']);
    expect(await store.updateRecording('a', { status: 'saved' })).toMatchObject({
      id: 'a',
      status: 'saved',
    });
    expect((await store.getRecording('a'))?.status).toBe('saved');
    expect(await store.updateRecording('missing', { status: 'saved' })).toBeUndefined();
    await store.deleteRecording('a');
    expect(await store.getRecording('a')).toBeUndefined();
  });

  it('stores chunks per recording in sequence order and counts/deletes them', async () => {
    store = openChunkStore(`test-${++counter}`);
    const put = (recordingId: string, seq: number) =>
      store.putChunk({
        recordingId,
        seq,
        blob: new Blob([`${seq}`]),
        byteLength: 1,
        receivedAt: seq,
      });
    await put('r1', 2);
    await put('r1', 0);
    await put('r1', 1);
    await put('r2', 0);
    expect((await store.getChunks('r1')).map((c) => c.seq)).toEqual([0, 1, 2]);
    expect(await store.countChunks('r1')).toBe(3);
    expect(await store.countChunks('r2')).toBe(1);
    await store.deleteChunks('r1');
    expect(await store.countChunks('r1')).toBe(0);
    expect(await store.countChunks('r2')).toBe(1);
  });

  it('lists the recordings that have chunks, whether their metadata is stored or not', async () => {
    store = openChunkStore(`test-${++counter}`);
    expect(await store.listRecordingIdsWithChunks()).toEqual([]);
    await store.putRecording(meta('no-chunks', 1));
    await store.putRecording(meta('known', 2));
    for (const [recordingId, seq] of [
      ['known', 0],
      ['known', 1],
      ['unknown', 0],
    ] as const) {
      await store.putChunk({
        recordingId,
        seq,
        blob: new Blob(['x']),
        byteLength: 1,
        receivedAt: 0,
      });
    }
    expect(await store.listRecordingIdsWithChunks()).toEqual(['known', 'unknown']);
  });

  it('deleting a recording removes its chunks too', async () => {
    store = openChunkStore(`test-${++counter}`);
    await store.putRecording(meta('r1', 1));
    await store.putChunk({
      recordingId: 'r1',
      seq: 0,
      blob: new Blob(['x']),
      byteLength: 1,
      receivedAt: 0,
    });
    await store.deleteRecording('r1');
    expect(await store.countChunks('r1')).toBe(0);
  });

  it('close is safe to call twice and reopens lazily', async () => {
    store = openChunkStore(`test-${++counter}`);
    await store.close();
    await store.putRecording(meta('a', 1));
    await store.close();
    await store.close();
    expect((await store.getRecording('a'))?.id).toBe('a');
  });
});
