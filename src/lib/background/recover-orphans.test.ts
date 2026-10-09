import { afterEach, describe, expect, it, vi } from 'vitest';
import { type ChunkStore, openChunkStore } from '@/lib/storage/open-chunk-store';
import type { RecordingMeta, RecordingStatus } from '@/lib/types';
import { recoverOrphans } from './recover-orphans';

let counter = 0;
let store: ChunkStore;

function meta(
  id: string,
  status: RecordingStatus,
  extra: Partial<RecordingMeta> = {},
): RecordingMeta {
  return {
    id,
    meetingCode: 'c',
    title: 't',
    startedAt: Number(id.replace(/\D/g, '')) || 1,
    mimeType: 'audio/webm',
    status,
    chunkCount: 0,
    byteSize: 0,
    ...extra,
  };
}

describe('recoverOrphans', () => {
  afterEach(async () => store.close());

  it('finalizes orphaned recordings with the right recovered flag and skips claimed/saved ones', async () => {
    store = openChunkStore(`recover-${++counter}`);
    await store.putRecording(meta('r1', 'recording'));
    await store.putRecording(meta('r2', 'interrupted', { endedAt: 50 }));
    await store.putRecording(meta('r3', 'ended'));
    await store.putRecording(meta('r4', 'finalizing'));
    await store.putRecording(meta('r5', 'saved'));
    await store.putRecording(meta('r6', 'failed'));
    await store.putRecording(meta('r7', 'recording'));
    // A recovered save stopped half way, and not even `failed` was stored: still recovered.
    await store.putRecording(meta('r8', 'finalizing', { recovered: true }));
    const finalize = vi.fn<(id: string, options: { recovered: boolean }) => Promise<undefined>>(
      async () => undefined,
    );
    const warnings: unknown[][] = [];
    const recovered = await recoverOrphans({
      store,
      claimedIds: () => ['r7'],
      finalize,
      now: () => 999,
      staleMs: 500,
      warn: (...args) => warnings.push(args),
    });
    expect(recovered.sort()).toEqual(['r1', 'r2', 'r3', 'r4', 'r8']);
    expect(finalize.mock.calls.map(([id, options]) => [id, options.recovered]).sort()).toEqual([
      ['r1', true],
      ['r2', true],
      ['r3', false],
      ['r4', false],
      ['r8', true],
    ]);
    expect(await store.getRecording('r1')).toMatchObject({ status: 'interrupted', endedAt: 999 });
    expect(await store.getRecording('r2')).toMatchObject({ status: 'interrupted', endedAt: 50 });
    expect((await store.getRecording('r7'))?.status).toBe('recording');
    expect(warnings).toEqual([]);
  });

  it('uses the wall clock by default', async () => {
    store = openChunkStore(`recover-${++counter}`);
    await store.putRecording(meta('r1', 'recording'));
    const before = Date.now();
    await recoverOrphans({
      store,
      claimedIds: () => [],
      finalize: async () => undefined,
      warn: () => undefined,
    });
    expect((await store.getRecording('r1'))?.endedAt).toBeGreaterThanOrEqual(before);
  });

  it('leaves unclaimed recordings alone while chunks are still arriving', async () => {
    store = openChunkStore(`recover-${++counter}`);
    await store.putRecording(meta('r1', 'recording', { startedAt: 100, lastChunkAt: 950 }));
    await store.putRecording(meta('r2', 'recording', { startedAt: 100, lastChunkAt: 100 }));
    await store.putRecording(meta('r3', 'recording', { startedAt: 990 }));
    const finalize = vi.fn(async () => undefined);
    const recovered = await recoverOrphans({
      store,
      claimedIds: () => [],
      finalize,
      now: () => 1000,
      staleMs: 500,
      warn: () => undefined,
    });
    expect(recovered).toEqual(['r2']);
    expect(finalize).toHaveBeenCalledTimes(1);
  });

  it.each([
    { status: 'recording', failing: 'updateRecording' },
    { status: 'ended', failing: 'finalize' },
  ] as const)(
    'logs an orphan whose $failing failed and still recovers the next one',
    async ({ status, failing }) => {
      store = openChunkStore(`recover-${++counter}`);
      // Listed newest first: r2 is handled before r1.
      await store.putRecording(meta('r1', 'recording'));
      await store.putRecording(meta('r2', status));
      // A full disk or a closed database; finalize rejects when its own catch block's store
      // update fails too.
      const failure = new DOMException('disk full', 'QuotaExceededError');
      const finalize = vi.fn<(id: string, options: { recovered: boolean }) => Promise<undefined>>(
        async () => undefined,
      );
      if (failing === 'updateRecording') {
        vi.spyOn(store, 'updateRecording').mockRejectedValueOnce(failure);
      } else {
        finalize.mockRejectedValueOnce(failure);
      }
      const warnings: unknown[][] = [];
      const recovered = await recoverOrphans({
        store,
        claimedIds: () => [],
        finalize,
        now: () => 999,
        staleMs: 500,
        warn: (...args) => warnings.push(args),
      });
      expect(recovered).toEqual(['r1']);
      expect(finalize).toHaveBeenLastCalledWith('r1', { recovered: true });
      expect(warnings).toEqual([['could not recover r2:', failure]]);
      // Its chunks stay in the store; the next background start tries again.
      expect((await store.getRecording('r2'))?.status).toBe(status);
    },
  );

  it('logs a pass that could not list the recordings, and resolves', async () => {
    store = openChunkStore(`recover-${++counter}`);
    const failure = new Error('the database connection is closing');
    vi.spyOn(store, 'listRecordings').mockRejectedValueOnce(failure);
    const finalize = vi.fn(async () => undefined);
    const warnings: unknown[][] = [];
    const recovered = await recoverOrphans({
      store,
      claimedIds: () => [],
      finalize,
      warn: (...args) => warnings.push(args),
    });
    expect(recovered).toEqual([]);
    expect(finalize).not.toHaveBeenCalled();
    expect(warnings).toEqual([['could not list the recordings to recover:', failure]]);
  });
});
