import { describe, expect, it, vi } from 'vitest';
import { type ChunkStore, openChunkStore } from '@/lib/storage/open-chunk-store';
import type { RecordingMeta, TabSnapshot } from '@/lib/types';
import { createLostTabs, type LostTabsDeps } from './create-lost-tabs';

// A real-time pause, only for checking that nothing happened: fake-indexeddb answers on
// setImmediate turns, so what the store must have done is awaited with vi.waitFor instead.
const flush = () => new Promise((r) => setTimeout(r, 10));
const ID = '0b6f2f4e-3c1d-4f6a-9a51-6a2e8c9d0e1f';

function snapshot(patch: Partial<TabSnapshot> = {}): TabSnapshot {
  return {
    state: 'recording',
    provider: 'meet',
    meetingCode: 'abc-defg-hij',
    title: 'Standup',
    recordingId: ID,
    recordingStartedAt: 1,
    remoteTracks: 1,
    micLabel: null,
    connected: true,
    admitted: true,
    ...patch,
  };
}

const recording = (patch: Partial<RecordingMeta> = {}): RecordingMeta => ({
  id: ID,
  meetingCode: 'abc-defg-hij',
  title: 'Standup',
  startedAt: 1,
  mimeType: 'video/webm',
  status: 'recording',
  chunkCount: 4,
  byteSize: 4096,
  lastChunkAt: 100,
  ...patch,
});

let counter = 0;

async function setup(overrides: Partial<LostTabsDeps> = {}, stored = recording()) {
  const store: ChunkStore = openChunkStore(`lost-tabs-${++counter}`);
  await store.putRecording(stored);
  const finalize = vi.fn(async () => undefined);
  const timers: { handler: () => void; ms: number }[] = [];
  const warnings: unknown[][] = [];
  const connected = new Set<number>([1]);
  const lostTabs = createLostTabs({
    store,
    finalize,
    setTimeout: (handler, ms) => {
      timers.push({ handler, ms });
      return timers.length;
    },
    graceMs: 10_000,
    now: () => 777,
    warn: (...args) => warnings.push(args),
    claimedNow: () => [],
    isConnected: (tabId) => connected.has(tabId),
    ...overrides,
  });
  /** Tab `tabId` loses its Port; `connected` follows, as the manager forgets the tab. */
  const lose = (tabId = 1, queue: Promise<void> = Promise.resolve(), tabSnapshot = snapshot()) => {
    connected.delete(tabId);
    lostTabs.lost({ tabId, snapshot: tabSnapshot, queue });
  };
  return { store, finalize, timers, warnings, lostTabs, lose };
}

const CLOSED_LINE = `the tab of recording ${ID} was closed before its end reached the background: saved under its own name with the 4 chunks stored`;

describe('createLostTabs', () => {
  it('saves the recording of a closed tab at once under its own name when its end never came', async () => {
    const { store, finalize, timers, warnings, lostTabs, lose } = await setup();

    // The browser reports the closed tab before its Port drops.
    lostTabs.closed(1);
    lose();

    await vi.waitFor(() => expect(finalize).toHaveBeenCalledWith(ID, { recovered: false }));
    expect(await store.getRecording(ID)).toMatchObject({ status: 'ended', endedAt: 777 });
    expect(warnings).toEqual([[CLOSED_LINE]]);
    expect(timers).toEqual([]);
  });

  it('ends it at once when the tab is reported closed during the grace, and only once', async () => {
    const { store, finalize, timers, lostTabs, lose } = await setup();

    lose();
    await vi.waitFor(() => expect(timers).toHaveLength(1));
    lostTabs.closed(1);

    await vi.waitFor(() => expect(finalize).toHaveBeenCalledWith(ID, { recovered: false }));
    timers[0]?.handler();
    await flush();
    expect(finalize).toHaveBeenCalledTimes(1);
    expect((await store.getRecording(ID))?.status).toBe('ended');
  });

  it('decides only once the lost tab has handled every message it received', async () => {
    const { finalize, lostTabs, lose } = await setup();
    let drain: () => void = () => undefined;
    const queue = new Promise<void>((resolve) => {
      drain = resolve;
    });

    lostTabs.closed(1);
    lose(1, queue);
    await flush();
    expect(finalize).not.toHaveBeenCalled();

    drain();
    await vi.waitFor(() => expect(finalize).toHaveBeenCalledWith(ID, { recovered: false }));
  });

  it('interrupts a lost tab that was not closed (a crash) after the grace, as recovered', async () => {
    const { store, finalize, timers, lose } = await setup();

    lose();
    await vi.waitFor(() => expect(timers).toHaveLength(1));
    expect(timers[0]?.ms).toBe(10_000);
    expect(finalize).not.toHaveBeenCalled();
    timers[0]?.handler();

    await vi.waitFor(() => expect(finalize).toHaveBeenCalledWith(ID, { recovered: true }));
    expect(await store.getRecording(ID)).toMatchObject({ status: 'interrupted', endedAt: 777 });
  });

  it.each([
    ['its end arrived before the tab closed', recording({ status: 'ended' }), []],
    ['another tab claims it now', recording(), [ID]],
    [
      'a chunk was stored after the queue drained: the page is alive',
      recording({ lastChunkAt: 900 }),
      [],
    ],
    ['nothing about it is stored', recording({ id: 'another recording' }), []],
  ])('leaves the recording alone when %s', async (_, stored, claimed) => {
    const { finalize, lostTabs, lose } = await setup({ claimedNow: () => claimed }, stored);

    lostTabs.closed(1);
    lose();
    await flush();
    await flush();

    expect(finalize).not.toHaveBeenCalled();
  });

  it('forgets the close of a tab it never knew, and of a tab that held no recording', async () => {
    const { finalize, timers, lostTabs, lose } = await setup();

    // Tab 2 never connected; tab 1 connected but its snapshot claims nothing.
    lostTabs.closed(2);
    lostTabs.closed(1);
    lose(1, Promise.resolve(), snapshot({ recordingId: null }));
    // Later, both ids lose a Port while recording: neither counts as closed any more.
    lose(2);
    lose(1);

    await vi.waitFor(() => expect(timers).toHaveLength(2));
    expect(finalize).not.toHaveBeenCalled();
  });

  it.each([
    { tab: 'closed', closed: true, failing: 'the store', status: 'recording' },
    { tab: 'closed', closed: true, failing: 'finalize', status: 'ended' },
    { tab: 'lost', closed: false, failing: 'the store', status: 'recording' },
    { tab: 'lost', closed: false, failing: 'finalize', status: 'interrupted' },
  ] as const)(
    'logs a $tab tab whose recording $failing could not save, and leaves it to recovery',
    async ({ closed, failing, status }) => {
      const { store, finalize, timers, warnings, lostTabs, lose } = await setup();
      // A full disk or a closed database; finalize rejects when its own catch block's store
      // update fails too. The chunks stay, and the next background start's recovery pass saves it.
      const failure = new DOMException('disk full', 'QuotaExceededError');
      if (failing === 'the store')
        vi.spyOn(store, 'updateRecording').mockRejectedValueOnce(failure);
      else finalize.mockRejectedValueOnce(failure);

      if (closed) lostTabs.closed(1);
      lose();
      if (!closed) {
        await vi.waitFor(() => expect(timers).toHaveLength(1));
        timers[0]?.handler();
      }

      const line = closed
        ? `could not save recording ${ID} of a closed tab:`
        : `could not interrupt ${ID}:`;
      await vi.waitFor(() => expect(warnings.at(-1)).toEqual([line, failure]));
      expect((await store.getRecording(ID))?.status).toBe(status);
    },
  );
});
