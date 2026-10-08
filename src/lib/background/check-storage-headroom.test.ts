import { describe, expect, it } from 'vitest';
import { checkStorageHeadroom } from './check-storage-headroom';

const GB = 1024 ** 3;

describe('checkStorageHeadroom', () => {
  it('is ok when enough space is free', async () => {
    await expect(
      checkStorageHeadroom({
        estimate: async () => ({ quota: 10 * GB, usage: 2 * GB }),
        needBytes: 3 * GB,
      }),
    ).resolves.toEqual({ ok: true, freeBytes: 8 * GB });
  });

  it('flags a shortfall and never reports negative space', async () => {
    await expect(
      checkStorageHeadroom({
        estimate: async () => ({ quota: 4 * GB, usage: 5 * GB }),
        needBytes: 3 * GB,
      }),
    ).resolves.toEqual({ ok: false, freeBytes: 0 });
    await expect(
      checkStorageHeadroom({ estimate: async () => ({ quota: 4 * GB }), needBytes: 3 * GB }),
    ).resolves.toEqual({ ok: true, freeBytes: 4 * GB });
  });

  it('assumes ok without an estimate or when the estimate fails', async () => {
    await expect(
      checkStorageHeadroom({ estimate: async () => ({}), needBytes: 1 }),
    ).resolves.toEqual({
      ok: true,
      freeBytes: null,
    });
    await expect(
      checkStorageHeadroom({
        estimate: async () => {
          throw new Error('no storage');
        },
        needBytes: 1,
      }),
    ).resolves.toEqual({ ok: true, freeBytes: null });
  });
});
