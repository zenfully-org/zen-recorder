import { describe, expect, it } from 'vitest';
import { openChunkStore } from './open-chunk-store';
import { putStrayChunks } from './put-stray-chunks';

const HOUR = 60 * 60 * 1000;

describe('putStrayChunks', () => {
  it('stores two chunks each of two recordings without metadata: one a day old, one new', async () => {
    const store = openChunkStore('put-stray-chunks');

    const { stale, recent } = await putStrayChunks(store, () => 30 * HOUR);

    expect(stale).toMatch(/^stray-/);
    expect(recent).toMatch(/^stray-/);
    expect((await store.listRecordingIdsWithChunks()).sort()).toEqual([stale, recent].sort());
    const staleChunks = await store.getChunks(stale);
    expect(staleChunks.map((chunk) => [chunk.seq, chunk.byteLength, chunk.receivedAt])).toEqual([
      [0, 1024, 5 * HOUR],
      [1, 1024, 5 * HOUR],
    ]);
    expect((await store.getChunks(recent)).map((chunk) => chunk.receivedAt)).toEqual([
      30 * HOUR,
      30 * HOUR,
    ]);
    expect(await store.getRecording(stale)).toBeUndefined();
    await store.close();
  });
});
