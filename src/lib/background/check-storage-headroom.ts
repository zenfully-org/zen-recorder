/**
 * Compares the browser's storage estimate with what a recording is expected to need, so the user
 * can be warned before a long video recording runs out of space.
 */

export interface StorageHeadroom {
  ok: boolean;
  /** Bytes available according to the estimate; null when the browser gives no estimate. */
  freeBytes: number | null;
}

export async function checkStorageHeadroom(input: {
  estimate: () => Promise<{ quota?: number; usage?: number }>;
  needBytes: number;
}): Promise<StorageHeadroom> {
  try {
    const { quota, usage } = await input.estimate();
    if (quota === undefined) return { ok: true, freeBytes: null };
    const freeBytes = Math.max(0, quota - (usage ?? 0));
    return { ok: freeBytes >= input.needBytes, freeBytes };
  } catch {
    return { ok: true, freeBytes: null };
  }
}
