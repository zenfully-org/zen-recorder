import { afterEach, describe, expect, it } from 'vitest';
import { type ChunkStore, openChunkStore } from '@/lib/storage/open-chunk-store';
import { createFaultInjectingStore } from './create-fault-injecting-store';

const RECORDING_ID = '4f3c6d2a-9d7c-4a4e-9f1e-0c1b2a3d4e5f';

const chunk = (seq: number) => ({
  recordingId: RECORDING_ID,
  seq,
  blob: new Blob([`chunk ${seq}`]),
  byteLength: 7,
  receivedAt: 1,
});

const recording = {
  id: RECORDING_ID,
  meetingCode: 'c',
  title: 't',
  startedAt: 1,
  mimeType: 'audio/webm',
  status: 'recording',
  chunkCount: 0,
  byteSize: 0,
} as const;

let counter = 0;
let inner: ChunkStore;

describe('createFaultInjectingStore', () => {
  afterEach(async () => inner.close());

  it('fails only the next putChunk, as a full disk would, and stores nothing for it', async () => {
    inner = openChunkStore(`faults-${++counter}`);
    const faults = createFaultInjectingStore(inner);
    await faults.store.putChunk(chunk(0));
    faults.failNextPutChunk();
    const failure = await faults.store.putChunk(chunk(1)).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(DOMException);
    expect(failure).toMatchObject({ name: 'QuotaExceededError' });
    await faults.store.putChunk(chunk(2));
    expect((await inner.getChunks(RECORDING_ID)).map((stored) => stored.seq)).toEqual([0, 2]);
  });

  it('fails every putChunk until restored, as a disk that stays full does, and says how many failed', async () => {
    inner = openChunkStore(`faults-${++counter}`);
    const faults = createFaultInjectingStore(inner);
    await faults.store.putChunk(chunk(0));
    faults.failPutChunks();
    for (const seq of [1, 1, 2]) {
      const failure = await faults.store.putChunk(chunk(seq)).catch((error: unknown) => error);
      expect(failure).toBeInstanceOf(DOMException);
      expect(failure).toMatchObject({ name: 'QuotaExceededError' });
    }
    expect(faults.restorePutChunks()).toBe(3);
    await faults.store.putChunk(chunk(1));
    expect((await inner.getChunks(RECORDING_ID)).map((stored) => stored.seq)).toEqual([0, 1]);
    // Restoring a store that does not fail counts nothing.
    expect(faults.restorePutChunks()).toBe(0);
  });

  it('fails only the next putRecording, as a full disk would, and stores nothing for it', async () => {
    inner = openChunkStore(`faults-${++counter}`);
    const faults = createFaultInjectingStore(inner);
    faults.failNextPutRecording();
    const failure = await faults.store.putRecording(recording).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(DOMException);
    expect(failure).toMatchObject({ name: 'QuotaExceededError' });
    expect(await inner.getRecording(RECORDING_ID)).toBeUndefined();
    await faults.store.putRecording(recording);
    expect(await inner.getRecording(RECORDING_ID)).toMatchObject({ status: 'recording' });
  });

  it('fails the next updates that mark a recording interrupted, one per call', async () => {
    inner = openChunkStore(`faults-${++counter}`);
    const faults = createFaultInjectingStore(inner);
    await inner.putRecording(recording);
    faults.failNextInterruption();
    faults.failNextInterruption();
    // Other updates (a chunk's running totals) are not what the e2e run means to fail.
    await faults.store.updateRecording(RECORDING_ID, { chunkCount: 1 });
    const interrupted = { status: 'interrupted', endedAt: 2 } as const;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const failure = await faults.store
        .updateRecording(RECORDING_ID, interrupted)
        .catch((error: unknown) => error);
      expect(failure).toBeInstanceOf(DOMException);
      expect(failure).toMatchObject({ name: 'QuotaExceededError' });
    }
    expect(await inner.getRecording(RECORDING_ID)).toMatchObject({
      status: 'recording',
      chunkCount: 1,
    });
    await faults.store.updateRecording(RECORDING_ID, interrupted);
    expect(await inner.getRecording(RECORDING_ID)).toMatchObject({ status: 'interrupted' });
  });

  it('holds the next putChunk until released, as a busy store does, and says how many it holds', async () => {
    inner = openChunkStore(`faults-${++counter}`);
    const faults = createFaultInjectingStore(inner);
    // Releasing with nothing held disarms nothing and frees nothing.
    expect(faults.releasePutChunks()).toBe(0);
    faults.holdNextPutChunk();
    let stored = false;
    const first = faults.store.putChunk(chunk(0)).then(() => {
      stored = true;
    });
    // Only the next one is held.
    await faults.store.putChunk(chunk(1));
    expect(faults.heldPutChunks()).toBe(1);
    expect(stored).toBe(false);
    expect((await inner.getChunks(RECORDING_ID)).map((saved) => saved.seq)).toEqual([1]);
    expect(faults.releasePutChunks()).toBe(1);
    await first;
    expect(faults.heldPutChunks()).toBe(0);
    expect((await inner.getChunks(RECORDING_ID)).map((saved) => saved.seq)).toEqual([0, 1]);
    // A hold no call used yet is disarmed by a release.
    faults.holdNextPutChunk();
    expect(faults.releasePutChunks()).toBe(0);
    await faults.store.putChunk(chunk(2));
    expect(await inner.countChunks(RECORDING_ID)).toBe(3);
  });

  it('passes every other call through to the wrapped store', async () => {
    inner = openChunkStore(`faults-${++counter}`);
    const { store } = createFaultInjectingStore(inner);
    await store.putRecording(recording);
    await store.putChunk(chunk(0));
    expect(await inner.getRecording(RECORDING_ID)).toMatchObject({ status: 'recording' });
    expect(await store.countChunks(RECORDING_ID)).toBe(1);
  });
});
