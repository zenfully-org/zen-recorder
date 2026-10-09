import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDefaultSettings } from '@/lib/settings/get-default-settings';
import { type ChunkStore, openChunkStore } from '@/lib/storage/open-chunk-store';
import type { RecordingStartedInfo, StopReason, TabSnapshot } from '@/lib/types';
import { createFakePort, type FakePort } from '@/test/fakes/create-fake-port';
import { createRecordingManager, type RecordingManagerDeps } from './create-recording-manager';

// A real-time pause, only for checking that nothing happened. fake-indexeddb advances on
// setImmediate turns, not on the clock: on a loaded machine 10 ms pass before the store has
// answered, so anything the store must have done is awaited with vi.waitFor instead.
const flush = () => new Promise((r) => setTimeout(r, 10));
const RECORDING_ID = '4f3c6d2a-9d7c-4a4e-9f1e-0c1b2a3d4e5f';
const STARTED: RecordingStartedInfo = {
  recordingId: RECORDING_ID,
  provider: 'meet',
  meetingCode: 'abc-defg-hij',
  title: 'Standup',
  startedAt: 5,
  mimeType: 'audio/webm',
  micLabel: null,
};
/** The number a bridge gave its first log line. */
const RECEIPT = { bridge: 'b1', seq: 1 };
/** What Diagnostics get when a recording's start cannot be stored. */
const START_NOT_STORED = `could not store the start of recording ${RECORDING_ID}, so it is not listed yet; trying again with its next chunk and its end:`;

function snapshot(patch: Partial<TabSnapshot> = {}): TabSnapshot {
  return {
    state: 'recording',
    provider: 'meet',
    meetingCode: 'abc-defg-hij',
    title: 'Standup',
    recordingId: RECORDING_ID,
    recordingStartedAt: 1,
    remoteTracks: 1,
    micLabel: null,
    connected: true,
    admitted: true,
    ...patch,
  };
}

/** A tab that writes no recording now but still delivers the chunks of a stopped one. */
const stoppedOnly = (id: string) => snapshot({ recordingId: null, pendingRecordingIds: [id] });

/** A chunk message of recording `recordingId`, holding the bytes of `text`. */
const chunkOf = (seq: number, text: string, timestampMs: number, recordingId = RECORDING_ID) => ({
  type: 'chunk',
  chunk: { recordingId, seq, blob: new Blob([text]), timestampMs },
});

/** The page's end of recording `RECORDING_ID`. */
const endOf = (chunkCount: number, durationMs: number, reason: StopReason = 'command') => ({
  type: 'recordingEnded',
  info: { recordingId: RECORDING_ID, chunkCount, durationMs, reason },
});

/** The messages of `type` the background posted on `port`, in order. */
const postedOn = (port: FakePort, type: string) =>
  port.posted.filter((m) => typeof m === 'object' && m !== null && 'type' in m && m.type === type);
const acksOn = (port: FakePort) => postedOn(port, 'ack');

let counter = 0;
let store: ChunkStore;

function setup(overrides: Partial<RecordingManagerDeps> = {}) {
  store = openChunkStore(`manager-${++counter}`);
  const finalize = vi.fn(async () => undefined);
  const changes: TabSnapshot[][] = [];
  const timers: { handler: () => void; ms: number }[] = [];
  const warnings: unknown[][] = [];
  const manager = createRecordingManager({
    store,
    loadSettings: async () => getDefaultSettings(),
    finalize,
    onSnapshotsChanged: (s) => changes.push(s),
    setTimeout: (handler, ms) => {
      timers.push({ handler, ms });
      return timers.length;
    },
    warn: (...args) => warnings.push(args),
    now: () => 777,
    ...overrides,
  });
  // The grace for a lost tab is armed once the tab's queue has drained: wait for timer `index`,
  // then let it run out.
  const runGrace = async (index: number) => {
    await vi.waitFor(() => expect(timers.length).toBeGreaterThan(index));
    timers[index]?.handler();
  };
  const connectTab = (tabId: number): FakePort => {
    const port = createFakePort('zen-recorder:tab', { tab: { id: tabId } } as never);
    manager.handlePort(port);
    return port;
  };
  return { manager, finalize, changes, timers, warnings, connectTab, runGrace };
}

describe('createRecordingManager', () => {
  beforeEach(() => vi.useRealTimers());
  afterEach(async () => store.close());

  it('rejects ports without a tab and pushes settings to real tabs', async () => {
    const { manager, connectTab } = setup();
    const anonymous = createFakePort('zen-recorder:tab');
    manager.handlePort(anonymous);
    expect(anonymous.disconnected).toBe(true);
    const port = connectTab(1);
    await flush();
    expect(port.posted).toEqual([{ type: 'settings', settings: getDefaultSettings() }]);
  });

  it('tracks snapshots per tab and exposes tabs, snapshots and claimed ids', async () => {
    const { manager, changes, connectTab } = setup();
    const port = connectTab(1);
    expect(manager.tabs()).toEqual([]);
    port.receive({ type: 'hello', snapshot: snapshot() });
    port.receive({ type: 'snapshot', snapshot: snapshot({ state: 'paused' }) });
    expect(manager.tabs()).toEqual([{ tabId: 1, snapshot: snapshot({ state: 'paused' }) }]);
    expect(manager.snapshots()).toHaveLength(1);
    expect(changes).toHaveLength(2);
    // What each tab claims: the recording it writes, and the stopped ones it still delivers.
    connectTab(2).receive({ type: 'snapshot', snapshot: stoppedOnly('r0') });
    expect(manager.claimedRecordingIds()).toEqual([RECORDING_ID, 'r0']);
  });

  it('keeps the previous snapshot when the same tab reconnects', () => {
    const { manager, connectTab } = setup();
    connectTab(1).receive({ type: 'snapshot', snapshot: snapshot() });
    connectTab(1);
    expect(manager.tabs()).toHaveLength(1);
  });

  it('warns about malformed messages', () => {
    const { warnings, connectTab } = setup();
    connectTab(1).receive({ type: 'bogus' });
    expect(warnings).toEqual([['ignoring malformed tab message', { type: 'bogus' }]]);
  });

  it('persists recordingStarted, chunks (with acks and running totals) and finalizes on end', async () => {
    const { finalize, connectTab } = setup();
    const port = connectTab(1);
    port.receive({
      type: 'recordingStarted',
      info: {
        ...STARTED,
        mimeType: 'video/webm;codecs=vp9,opus',
        micLabel: 'USB mic',
        hasVideo: true,
      },
    });
    await vi.waitFor(async () => {
      expect(await store.getRecording(RECORDING_ID)).toMatchObject({
        status: 'recording',
        micLabel: 'USB mic',
        hasVideo: true,
        chunkCount: 0,
      });
    });
    port.receive(chunkOf(0, 'ab', 3000));
    port.receive(chunkOf(1, 'cde', 6000));
    await vi.waitFor(async () => {
      expect(await store.getRecording(RECORDING_ID)).toMatchObject({
        chunkCount: 2,
        byteSize: 5,
        durationMs: 6000,
      });
    });
    expect(await store.countChunks(RECORDING_ID)).toBe(2);
    expect(acksOn(port)).toEqual([
      { type: 'ack', recordingId: RECORDING_ID, seq: 0 },
      { type: 'ack', recordingId: RECORDING_ID, seq: 1 },
    ]);
    port.receive(endOf(2, 6100));
    await vi.waitFor(async () => {
      expect(await store.getRecording(RECORDING_ID)).toMatchObject({
        status: 'ended',
        endedAt: 777,
        durationMs: 6100,
      });
    });
    expect(finalize).toHaveBeenCalledWith(RECORDING_ID, { recovered: false });
  });

  it('stores and acks a chunk of a recording it does not know yet', async () => {
    const { connectTab } = setup();
    const port = connectTab(1);
    port.receive(chunkOf(0, 'x', 0));
    await vi.waitFor(() =>
      expect(port.posted).toContainEqual({ type: 'ack', recordingId: RECORDING_ID, seq: 0 }),
    );
    expect(await store.countChunks(RECORDING_ID)).toBe(1);
    expect(await store.getRecording(RECORDING_ID)).toBeUndefined();
  });

  it('tells only the tab whose chunks cannot be stored, once until one is stored again', async () => {
    const { connectTab } = setup();
    const full = new DOMException('disk full', 'QuotaExceededError');
    const putChunk = vi.spyOn(store, 'putChunk').mockRejectedValueOnce(full);
    putChunk.mockRejectedValueOnce(full);
    const idle = connectTab(2);
    idle.receive({ type: 'hello', snapshot: snapshot({ state: 'waiting', recordingId: null }) });
    const port = connectTab(1);
    port.receive({ type: 'recordingStarted', info: STARTED });
    // Refused twice, then stored: the page sends a chunk again until it is acked.
    for (let send = 0; send < 3; send += 1) port.receive(chunkOf(0, 'ab', 3000));
    await vi.waitFor(() => expect(acksOn(port)).toHaveLength(1));
    expect(postedOn(port, 'error')).toEqual([
      {
        type: 'error',
        recordingId: RECORDING_ID,
        message: expect.stringContaining('disk is full'),
      },
    ]);
    putChunk.mockRejectedValueOnce(full);
    port.receive(chunkOf(1, 'cde', 6000));
    await vi.waitFor(() => expect(postedOn(port, 'error')).toHaveLength(2));
    expect(postedOn(idle, 'error')).toEqual([]);
  });

  it('logs the settings it cannot read for a new tab, whose messages it handles all the same', async () => {
    const failure = new Error('the database connection is closing');
    const { connectTab, warnings } = setup({ loadSettings: () => Promise.reject(failure) });
    const port = connectTab(1);
    port.receive(chunkOf(0, 'x', 0));
    await vi.waitFor(() => expect(acksOn(port)).toHaveLength(1));
    expect(warnings).toEqual([['could not send the settings to tab 1:', failure]]);
  });

  it('ignores pings and tolerates a port that throws on post', async () => {
    const { manager, connectTab } = setup();
    const port = connectTab(1);
    port.receive({ type: 'ping' });
    port.failNextPost();
    expect(() => manager.sendCommand(1, 'pause')).not.toThrow();
  });

  it('sends commands, toggles based on state, and broadcasts settings', () => {
    const { manager, connectTab } = setup();
    const port = connectTab(1);
    expect(() => manager.sendCommand(9, 'stop')).toThrow(/no longer connected \(it was closed/);
    manager.sendCommand(1, 'pause');
    expect(manager.toggle(1)).toBe(false);
    port.receive({ type: 'snapshot', snapshot: snapshot({ state: 'waiting', recordingId: null }) });
    expect(manager.toggle(1)).toBe(true);
    port.receive({ type: 'snapshot', snapshot: snapshot({ state: 'paused' }) });
    expect(manager.toggle(1)).toBe(true);
    expect(manager.toggle(42)).toBe(false);
    const settings = { ...getDefaultSettings(), autoRecord: false };
    manager.broadcastSettings(settings);
    expect(postedOn(port, 'command')).toEqual(
      ['pause', 'start', 'stop'].map((command) => ({ type: 'command', command })),
    );
    expect(postedOn(port, 'settings').at(-1)).toEqual({ type: 'settings', settings });
  });

  it('notifies only the tab a recording comes from, also once that tab is idle', () => {
    const { manager, connectTab } = setup();
    const owner = connectTab(1);
    const idle = connectTab(2);
    owner.receive({ type: 'recordingStarted', info: STARTED });
    // Stopped, the tab names no recording any more, like a tab that never recorded.
    const stopped = snapshot({ recordingId: null, state: 'idle' });
    for (const tab of [owner, idle]) tab.receive({ type: 'snapshot', snapshot: stopped });
    const message = { type: 'error', recordingId: RECORDING_ID, message: 'x' } as const;
    manager.notifyRecording(RECORDING_ID, message);
    manager.notifyRecording('never-announced', { ...message, recordingId: 'never-announced' });
    expect(postedOn(owner, 'error')).toEqual([message]);
    expect(postedOn(idle, 'error')).toEqual([]);
  });

  it('relays page log lines to the diagnostics hook at once, acks them, and tolerates its absence', () => {
    const logs: unknown[] = [];
    const { connectTab } = setup({ onLog: (log, tabId) => logs.push({ ...log, tabId }) });
    const port = connectTab(3);
    port.receive({ type: 'log', log: { level: 'warn', message: 'careful' }, receipt: RECEIPT });
    expect(logs).toEqual([{ level: 'warn', message: 'careful', tabId: 3 }]);
    expect(postedOn(port, 'logAck')).toEqual([{ type: 'logAck', seq: 1 }]);
    const bare = setup();
    bare.connectTab(4).receive({ type: 'log', log: { level: 'info', message: 'ok' } });
    expect(bare.warnings).toEqual([]);
  });

  it('drops chunks and end notices for a recording that was already finalized', async () => {
    const { finalize, warnings, connectTab } = setup();
    const port = connectTab(1);
    port.receive({ type: 'recordingStarted', info: STARTED });
    await vi.waitFor(async () => expect(await store.getRecording(RECORDING_ID)).toBeDefined());
    await store.updateRecording(RECORDING_ID, { status: 'saved' });
    port.receive(chunkOf(7, 'late', 9000));
    port.receive(endOf(8, 9000));
    await vi.waitFor(() => expect(warnings.length).toBeGreaterThanOrEqual(2));
    expect(await store.countChunks(RECORDING_ID)).toBe(0);
    expect(port.posted).toContainEqual({ type: 'ack', recordingId: RECORDING_ID, seq: 7 });
    // Acked too, so a page that sends it again until it is acked stops.
    expect(port.posted).toContainEqual({ type: 'endAck', recordingId: RECORDING_ID });
    expect((await store.getRecording(RECORDING_ID))?.status).toBe('saved');
    expect(finalize).not.toHaveBeenCalled();
    expect(warnings.flat().join(' | ')).toMatch(/dropping chunk 7 .* already saved/);
    expect(warnings.flat().join(' | ')).toMatch(/ignoring end .* already saved/);
  });

  it.each(['putChunk', 'updateRecording'] as const)(
    'does not ack a chunk whose %s failed, stores its resend once and keeps handling the tab',
    async (method) => {
      const logs: string[] = [];
      const { warnings, connectTab } = setup({ onLog: (log) => logs.push(log.message) });
      const port = connectTab(1);
      const acks = () => acksOn(port);
      port.receive({ type: 'recordingStarted', info: STARTED });
      await vi.waitFor(async () => expect(await store.getRecording(RECORDING_ID)).toBeDefined());
      const diskFull = new DOMException('disk full', 'QuotaExceededError');
      vi.spyOn(store, method).mockRejectedValueOnce(diskFull);
      const first = {
        recordingId: RECORDING_ID,
        seq: 0,
        blob: new Blob(['ab']),
        timestampMs: 3000,
      };
      port.receive({ type: 'chunk', chunk: first });
      port.receive({ type: 'log', log: { level: 'info', message: 'after the failure' } });
      await vi.waitFor(() => expect(logs).toEqual(['after the failure']));
      expect(acks()).toEqual([]);
      // The page's chunk sender sends a chunk again until it is acked, then the next one.
      port.receive({ type: 'chunk', chunk: first });
      port.receive(chunkOf(1, 'cde', 6000));
      await vi.waitFor(() =>
        expect(acks()).toEqual([
          { type: 'ack', recordingId: RECORDING_ID, seq: 0 },
          { type: 'ack', recordingId: RECORDING_ID, seq: 1 },
        ]),
      );
      expect(await store.countChunks(RECORDING_ID)).toBe(2);
      expect(await store.getRecording(RECORDING_ID)).toMatchObject({ chunkCount: 2, byteSize: 5 });
      expect(warnings).toEqual([
        [`could not handle chunk 0 of ${RECORDING_ID} from tab 1:`, diskFull],
      ]);
    },
  );

  it('counts a chunk once when its first send was only late and the page sent it again', async () => {
    let clock = 1000;
    const { warnings, connectTab } = setup({ now: () => clock });
    const port = connectTab(1);
    const acks = () => acksOn(port);
    port.receive({ type: 'recordingStarted', info: STARTED });
    const first = { recordingId: RECORDING_ID, seq: 0, blob: new Blob(['ab']), timestampMs: 3000 };
    port.receive({ type: 'chunk', chunk: first });
    await vi.waitFor(() => expect(acks()).toHaveLength(1));
    // The store answered after the bridge's ack timeout: the page sent the same chunk again, and
    // that send waited in the tab's queue behind the first one.
    clock = 2000;
    port.receive({ type: 'chunk', chunk: first });
    await vi.waitFor(() => expect(acks()).toHaveLength(2));
    expect(await store.countChunks(RECORDING_ID)).toBe(1);
    expect(await store.getRecording(RECORDING_ID)).toMatchObject({
      chunkCount: 1,
      byteSize: 2,
      durationMs: 3000,
      // A chunk that arrives still says the page is alive.
      lastChunkAt: 2000,
    });
    port.receive(chunkOf(1, 'cde', 6000));
    await vi.waitFor(() => expect(acks()).toHaveLength(3));
    expect(await store.getRecording(RECORDING_ID)).toMatchObject({
      chunkCount: 2,
      byteSize: 5,
      durationMs: 6000,
    });
    expect(warnings).toEqual([]);
  });

  it('saves a recording whose start could not be stored: its next chunk stores it', async () => {
    const started: RecordingStartedInfo[] = [];
    const { finalize, warnings, connectTab } = setup({
      onRecordingStarted: (info) => started.push(info),
    });
    const failure = new DOMException('disk full', 'QuotaExceededError');
    const putRecording = vi.spyOn(store, 'putRecording').mockRejectedValueOnce(failure);
    const port = connectTab(1);
    port.receive({ type: 'recordingStarted', info: STARTED });
    for (const [seq, text] of ['ab', 'cde', 'f'].entries()) {
      port.receive(chunkOf(seq, text, seq * 3000));
    }
    port.receive(endOf(3, 9000));
    await vi.waitFor(() =>
      expect(port.posted).toContainEqual({ type: 'endAck', recordingId: RECORDING_ID }),
    );
    expect(await store.getRecording(RECORDING_ID)).toMatchObject({
      title: 'Standup',
      mimeType: 'audio/webm',
      status: 'ended',
      chunkCount: 3,
      byteSize: 6,
      durationMs: 9000,
    });
    expect(finalize).toHaveBeenCalledWith(RECORDING_ID, { recovered: false });
    // The failed start, then once more with the first chunk.
    expect(putRecording).toHaveBeenCalledTimes(2);
    expect(started).toEqual([STARTED]);
    expect(warnings).toEqual([[START_NOT_STORED, failure]]);
  });

  it('stores a start that keeps failing with the end, counting the chunks stored meanwhile, and saves the closed tab', async () => {
    const { finalize, warnings, connectTab } = setup();
    const failure = new DOMException('disk full', 'QuotaExceededError');
    // The start, then the tries with chunks 0 and 1.
    vi.spyOn(store, 'putRecording')
      .mockRejectedValueOnce(failure)
      .mockRejectedValueOnce(failure)
      .mockRejectedValueOnce(failure);
    const port = connectTab(1);
    port.receive({ type: 'recordingStarted', info: STARTED });
    for (const [seq, text] of ['ab', 'cde'].entries()) {
      port.receive(chunkOf(seq, text, seq * 3000));
    }
    // The chunks are stored and acked all the same: the page holds no more than it must.
    await vi.waitFor(() =>
      expect(port.posted).toContainEqual({ type: 'ack', recordingId: RECORDING_ID, seq: 1 }),
    );
    expect(await store.getRecording(RECORDING_ID)).toBeUndefined();
    // The bridge's end for a tab that went away: nothing sends it again.
    port.receive(endOf(2, 3000, 'pagehide'));
    await vi.waitFor(() =>
      expect(port.posted).toContainEqual({ type: 'endAck', recordingId: RECORDING_ID }),
    );
    expect(await store.getRecording(RECORDING_ID)).toMatchObject({
      status: 'ended',
      chunkCount: 2,
      byteSize: 5,
    });
    expect(finalize).toHaveBeenCalledWith(RECORDING_ID, { recovered: false });
    // One line for the start, none for each chunk that could not store it either.
    expect(warnings).toEqual([[START_NOT_STORED, failure]]);
  });

  it('does not ack the end of a recording whose start still cannot be stored, says so, and saves it when the end comes again', async () => {
    const { finalize, warnings, connectTab } = setup();
    const failure = new DOMException('disk full', 'QuotaExceededError');
    const putRecording = vi.spyOn(store, 'putRecording').mockRejectedValue(failure);
    const port = connectTab(1);
    port.receive({ type: 'recordingStarted', info: STARTED });
    const ended = endOf(0, 40);
    port.receive(ended);
    await vi.waitFor(() => expect(warnings).toHaveLength(2));
    expect(port.posted).not.toContainEqual({ type: 'endAck', recordingId: RECORDING_ID });
    expect(finalize).not.toHaveBeenCalled();
    expect(warnings).toEqual([
      [START_NOT_STORED, failure],
      [
        `recording ${RECORDING_ID} ended, but its start still cannot be stored, so no file is saved yet; the meeting tab sends the end again until it is (a closed tab cannot)`,
      ],
    ]);
    // Without an ack the page sends the end again, and the store works by then.
    putRecording.mockRestore();
    port.receive(ended);
    await vi.waitFor(() =>
      expect(port.posted).toContainEqual({ type: 'endAck', recordingId: RECORDING_ID }),
    );
    expect(await store.getRecording(RECORDING_ID)).toMatchObject({ status: 'ended' });
    expect(finalize).toHaveBeenCalledWith(RECORDING_ID, { recovered: false });
  });

  it('acks the end of a recording nothing is stored for, says no file is saved, and finalizes nothing', async () => {
    const { finalize, warnings, connectTab } = setup();
    const port = connectTab(1);
    port.receive(endOf(2, 40));
    await vi.waitFor(() =>
      expect(port.posted).toContainEqual({ type: 'endAck', recordingId: RECORDING_ID }),
    );
    expect(finalize).not.toHaveBeenCalled();
    expect(warnings).toEqual([
      [
        `no file is saved for recording ${RECORDING_ID}: it ended, but nothing about it is stored (it was removed from the list, or its start never reached storage)`,
      ],
    ]);
  });

  it('saves a recording announced while the Port was down from the announcement its end carries', async () => {
    const { finalize, warnings, connectTab } = setup();
    const port = connectTab(1);
    // Its chunks are stored, and acked, before anything announces the recording.
    port.receive(chunkOf(0, 'ab', 3000));
    port.receive(chunkOf(1, 'cde', 6000));
    await vi.waitFor(() => expect(acksOn(port)).toHaveLength(2));
    const ended = endOf(2, 6100);
    port.receive({ ...ended, info: { ...ended.info, started: STARTED } });
    await vi.waitFor(() =>
      expect(port.posted).toContainEqual({ type: 'endAck', recordingId: RECORDING_ID }),
    );
    expect(await store.getRecording(RECORDING_ID)).toMatchObject({
      status: 'ended',
      title: STARTED.title,
      chunkCount: 2,
      byteSize: 5,
    });
    expect(finalize).toHaveBeenCalledWith(RECORDING_ID, { recovered: false });
    expect(warnings).toEqual([]);
  });

  it('keeps handling a tab after ending its recording failed', async () => {
    const logs: string[] = [];
    const { finalize, warnings, connectTab } = setup({
      onLog: (log) => logs.push(log.message),
    });
    const failure = new Error('IndexedDB failed');
    finalize.mockRejectedValueOnce(failure);
    const port = connectTab(1);
    port.receive({ type: 'recordingStarted', info: STARTED });
    port.receive({ type: 'log', log: { level: 'info', message: 'before the failure' } });
    port.receive(endOf(0, 0));
    port.receive({ type: 'log', log: { level: 'info', message: 'after the failure' } });
    await vi.waitFor(() => expect(logs).toEqual(['before the failure', 'after the failure']));
    // Finalizing runs outside the tab's queue; its failure is logged all the same.
    await vi.waitFor(() =>
      expect(warnings).toEqual([[`could not finalize ${RECORDING_ID}:`, failure]]),
    );
  });

  it('does not ack or finalize an end that could not be stored, and stores it when sent again', async () => {
    const { finalize, warnings, connectTab } = setup();
    const failure = new DOMException('disk full', 'QuotaExceededError');
    const port = connectTab(1);
    port.receive({ type: 'recordingStarted', info: STARTED });
    await vi.waitFor(async () => expect(await store.getRecording(RECORDING_ID)).toBeDefined());
    vi.spyOn(store, 'updateRecording').mockRejectedValueOnce(failure);
    const ended = endOf(0, 40);
    port.receive(ended);
    await vi.waitFor(() => expect(warnings).toHaveLength(1));
    expect(finalize).not.toHaveBeenCalled();
    expect(port.posted).not.toContainEqual({ type: 'endAck', recordingId: RECORDING_ID });
    expect(warnings).toEqual([['could not handle recordingEnded from tab 1:', failure]]);
    expect(await store.getRecording(RECORDING_ID)).toMatchObject({ status: 'recording' });
    // Without an ack the page sends the end again, as it does a chunk.
    port.receive(ended);
    await vi.waitFor(() =>
      expect(port.posted).toContainEqual({ type: 'endAck', recordingId: RECORDING_ID }),
    );
    expect(await store.getRecording(RECORDING_ID)).toMatchObject({
      status: 'ended',
      durationMs: 40,
    });
    expect(finalize).toHaveBeenCalledWith(RECORDING_ID, { recovered: false });
  });

  it('acks the end of a recording once it is stored, and an end sent again without finalizing twice', async () => {
    const { finalize, warnings, connectTab } = setup();
    const port = connectTab(1);
    const endAcks = () =>
      port.posted.filter(
        (m) => typeof m === 'object' && m !== null && 'type' in m && m.type === 'endAck',
      );
    port.receive({ type: 'recordingStarted', info: STARTED });
    const ended = endOf(0, 40);
    port.receive(ended);
    await vi.waitFor(() =>
      expect(endAcks()).toEqual([{ type: 'endAck', recordingId: RECORDING_ID }]),
    );
    expect(await store.getRecording(RECORDING_ID)).toMatchObject({ status: 'ended' });
    // The ack was lost on its way (the Port dropped): the page sends the same end again.
    port.receive(ended);
    await vi.waitFor(() => expect(endAcks()).toHaveLength(2));
    expect(finalize).toHaveBeenCalledTimes(1);
    expect(warnings).toEqual([[`ignoring end of ${RECORDING_ID}: already ended`]]);
  });

  it('saves a closed tab at once under its own name: its pagehide end follows the last chunk, and the grace interruption finds it ended', async () => {
    let time = 1000;
    const { finalize, warnings, connectTab, runGrace } = setup({ now: () => time });
    const port = connectTab(1);
    port.receive({ type: 'snapshot', snapshot: snapshot() });
    port.receive({ type: 'recordingStarted', info: STARTED });
    // The bridge posts the end on `pagehide`, right behind the last chunk, and the Port drops
    // before the queue has stored either.
    port.receive(chunkOf(0, 'ab', 3000));
    port.receive(endOf(1, 3000, 'pagehide'));
    port.disconnectFromOtherSide();
    time = 1005;
    await vi.waitFor(() =>
      expect(finalize).toHaveBeenCalledWith(RECORDING_ID, { recovered: false }),
    );
    // The grace for the lost tab runs out 10 s later and finds the recording ended.
    time = 11_005;
    await runGrace(0);
    await flush();
    expect(finalize).toHaveBeenCalledTimes(1);
    expect(await store.getRecording(RECORDING_ID)).toMatchObject({
      status: 'ended',
      endedAt: 1005,
      chunkCount: 1,
    });
    expect(warnings).toEqual([]);
  });

  it('finalizes an end that counts chunks the background never stored, and says so', async () => {
    const { finalize, warnings, connectTab } = setup();
    const port = connectTab(1);
    port.receive({ type: 'recordingStarted', info: STARTED });
    port.receive(chunkOf(0, 'ab', 3000));
    // The page handed the bridge a second chunk that never got stored, then went away.
    port.receive(endOf(2, 6000, 'pagehide'));
    await vi.waitFor(() =>
      expect(finalize).toHaveBeenCalledWith(RECORDING_ID, { recovered: false }),
    );
    expect(warnings).toEqual([
      [`end of ${RECORDING_ID} (pagehide) counts 2 chunks, 1 stored: the file ends early`],
    ]);
  });

  it('handles the next recording of a tab while the previous one is still finalizing', async () => {
    const logs: string[] = [];
    const { finalize, connectTab } = setup({ onLog: (log) => logs.push(log.message) });
    // A long video takes 15-42 s to remux and save; this one never finishes.
    finalize.mockReturnValueOnce(new Promise(() => undefined));
    const next = '11111111-2222-4333-8444-555555555555';
    const started = (recordingId: string) => ({
      type: 'recordingStarted',
      info: { ...STARTED, recordingId },
    });
    const port = connectTab(1);
    port.receive(started(RECORDING_ID));
    port.receive(endOf(0, 0, 'encoder-error'));
    port.receive(started(next));
    port.receive(chunkOf(0, 'ab', 3000, next));
    port.receive({ type: 'log', log: { level: 'info', message: 'next recording running' } });
    await vi.waitFor(() =>
      expect(port.posted).toContainEqual({ type: 'ack', recordingId: next, seq: 0 }),
    );
    await vi.waitFor(() => expect(logs).toEqual(['next recording running']));
    expect(finalize).toHaveBeenCalledWith(RECORDING_ID, { recovered: false });
    expect(await store.getRecording(RECORDING_ID)).toMatchObject({ status: 'ended' });
    expect(await store.getRecording(next)).toMatchObject({
      status: 'recording',
      chunkCount: 1,
      byteSize: 2,
    });
  });

  it('does not interrupt a recording whose chunks are still arriving after a port loss', async () => {
    let time = 1000;
    const { finalize, timers, connectTab, runGrace } = setup({
      interruptGraceMs: 5000,
      now: () => time,
    });
    const port = connectTab(1);
    port.receive({ type: 'snapshot', snapshot: snapshot() });
    port.receive({ type: 'recordingStarted', info: STARTED });
    await vi.waitFor(async () => expect(await store.getRecording(RECORDING_ID)).toBeDefined());
    port.disconnectFromOtherSide();
    await vi.waitFor(() => expect(timers).toHaveLength(1));
    // Another port (a reloaded bridge) keeps delivering chunks for the same recording.
    const other = connectTab(2);
    time = 5000;
    other.receive(chunkOf(0, 'ab', 3000));
    await vi.waitFor(async () =>
      expect((await store.getRecording(RECORDING_ID))?.lastChunkAt).toBe(5000),
    );
    time = 6000;
    await runGrace(0);
    await flush();
    expect(finalize).not.toHaveBeenCalled();
    expect((await store.getRecording(RECORDING_ID))?.status).toBe('recording');
  });

  it('interrupts a lost tab whose last chunk is stored after its port dropped', async () => {
    let time = 1000;
    const { finalize, timers, connectTab } = setup({ now: () => time });
    const port = connectTab(1);
    port.receive({ type: 'snapshot', snapshot: snapshot() });
    port.receive({ type: 'recordingStarted', info: STARTED });
    await vi.waitFor(async () => expect(await store.getRecording(RECORDING_ID)).toBeDefined());
    // A tab that dies without `pagehide` (a crash): its last chunk arrives right before its port
    // drops, and is stored a few milliseconds after.
    port.receive(chunkOf(0, 'ab', 3000));
    port.disconnectFromOtherSide();
    time = 1005;
    await vi.waitFor(async () =>
      expect((await store.getRecording(RECORDING_ID))?.lastChunkAt).toBe(1005),
    );
    await vi.waitFor(() => expect(timers).toHaveLength(1));
    time = 11_000;
    timers[0]?.handler();
    // That chunk came from the tab that is gone: it is no sign of a page still recording.
    await vi.waitFor(() =>
      expect(finalize).toHaveBeenCalledWith(RECORDING_ID, { recovered: true }),
    );
    expect(await store.getRecording(RECORDING_ID)).toMatchObject({
      status: 'interrupted',
      endedAt: 11_000,
      chunkCount: 1,
    });
  });

  it('interrupts a lost tab only once every chunk it delivered is stored', async () => {
    const { finalize, timers, connectTab } = setup();
    const chunksAtFinalize: number[] = [];
    finalize.mockImplementation(async () => {
      chunksAtFinalize.push(await store.countChunks(RECORDING_ID));
      return undefined;
    });
    const port = connectTab(1);
    port.receive({ type: 'snapshot', snapshot: snapshot() });
    port.receive({ type: 'recordingStarted', info: STARTED });
    await vi.waitFor(async () => expect(await store.getRecording(RECORDING_ID)).toBeDefined());
    // A busy store: the chunk the tab delivered before it died is still being stored.
    const putChunk = store.putChunk;
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    vi.spyOn(store, 'putChunk').mockImplementationOnce(async (chunk) => {
      await held;
      return putChunk(chunk);
    });
    port.receive(chunkOf(0, 'ab', 3000));
    port.disconnectFromOtherSide();
    await flush();
    const runTimers = () => {
      for (const timer of timers.splice(0)) timer.handler();
    };
    // Whatever grace was armed runs out while the chunk is still being stored.
    runTimers();
    await flush();
    release();
    await vi.waitFor(() => {
      runTimers();
      expect(finalize).toHaveBeenCalledWith(RECORDING_ID, { recovered: true });
    });
    expect(chunksAtFinalize).toEqual([1]);
    expect(await store.getRecording(RECORDING_ID)).toMatchObject({
      status: 'interrupted',
      chunkCount: 1,
    });
  });

  it('interrupts a recording when its tab disappears and does not reconnect in time', async () => {
    const { manager, finalize, timers, changes, connectTab } = setup();
    const port = connectTab(1);
    port.receive({ type: 'recordingStarted', info: STARTED });
    // A stopped recording whose chunks the tab still held is lost with it, like the one it writes.
    port.receive({ type: 'snapshot', snapshot: stoppedOnly(RECORDING_ID) });
    await vi.waitFor(async () => expect(await store.getRecording(RECORDING_ID)).toBeDefined());
    port.disconnectFromOtherSide();
    expect(manager.tabs()).toEqual([]);
    expect(changes.at(-1)).toEqual([]);
    await vi.waitFor(() => expect(timers).toHaveLength(1));
    expect(timers[0]?.ms).toBe(10_000);
    timers[0]?.handler();
    // finalize runs once the interruption is stored.
    await vi.waitFor(() =>
      expect(finalize).toHaveBeenCalledWith(RECORDING_ID, { recovered: true }),
    );
    expect(await store.getRecording(RECORDING_ID)).toMatchObject({
      status: 'interrupted',
      endedAt: 777,
    });
  });

  it.each([
    { failing: 'the store', status: 'recording', finalized: false },
    { failing: 'finalize', status: 'interrupted', finalized: true },
  ] as const)(
    'logs an interruption that failed in $failing and leaves the recording to recovery',
    async ({ failing, status, finalized }) => {
      const { finalize, warnings, connectTab, runGrace } = setup();
      const port = connectTab(1);
      port.receive({ type: 'recordingStarted', info: STARTED });
      port.receive({ type: 'snapshot', snapshot: snapshot() });
      await vi.waitFor(async () => expect(await store.getRecording(RECORDING_ID)).toBeDefined());
      // A full disk or a closed database; finalize rejects when its own catch block's store
      // update fails too.
      const failure = new DOMException('disk full', 'QuotaExceededError');
      if (failing === 'the store') {
        vi.spyOn(store, 'updateRecording').mockRejectedValueOnce(failure);
      } else {
        finalize.mockRejectedValueOnce(failure);
      }
      port.disconnectFromOtherSide();
      await runGrace(0);
      await vi.waitFor(() =>
        expect(warnings).toEqual([[`could not interrupt ${RECORDING_ID}:`, failure]]),
      );
      expect(finalize).toHaveBeenCalledTimes(finalized ? 1 : 0);
      // Its chunks stay in the store; the next background start's recovery pass saves it.
      expect((await store.getRecording(RECORDING_ID))?.status).toBe(status);
    },
  );

  it('does not interrupt when the tab reconnected, when it was not recording, or when unknown', async () => {
    const { finalize, connectTab, runGrace } = setup({ interruptGraceMs: 5 });
    const port = connectTab(1);
    port.receive({ type: 'snapshot', snapshot: snapshot() });
    port.disconnectFromOtherSide();
    const again = connectTab(1);
    // Reconnected, the page claims it as a stopped recording whose chunks are on their way.
    again.receive({ type: 'snapshot', snapshot: stoppedOnly(RECORDING_ID) });
    await runGrace(0);
    await flush();
    expect(finalize).not.toHaveBeenCalled();

    // Unknown recording id: nothing to interrupt.
    again.disconnectFromOtherSide();
    await runGrace(1);
    await flush();
    expect(finalize).not.toHaveBeenCalled();

    // Already ended: leave it alone.
    await store.putRecording({
      id: RECORDING_ID,
      meetingCode: 'c',
      title: 't',
      startedAt: 1,
      mimeType: 'm',
      status: 'saved',
      chunkCount: 0,
      byteSize: 0,
    });
    const third = connectTab(1);
    third.receive({ type: 'snapshot', snapshot: snapshot() });
    third.disconnectFromOtherSide();
    await runGrace(2);
    await flush();
    expect(finalize).not.toHaveBeenCalled();
    expect((await store.getRecording(RECORDING_ID))?.status).toBe('saved');
  });

  it('treats a tab paused before its next recording as owning no recording', async () => {
    // A recording that failed while paused: its file is saving, the next one starts on Resume.
    const { manager, finalize, timers, connectTab } = setup({ interruptGraceMs: 5 });
    const port = connectTab(1);
    port.receive({ type: 'recordingStarted', info: STARTED });
    const paused = snapshot({ state: 'paused', recordingId: null, recordingStartedAt: null });
    port.receive({ type: 'snapshot', snapshot: paused });
    expect(manager.snapshots()).toEqual([paused]);
    expect(manager.claimedRecordingIds()).toEqual([]);
    // The failed recording's "saved" still reaches the tab, for its toast.
    const saved = {
      type: 'saved',
      recordingId: RECORDING_ID,
      filename: 'Standup.webm',
      chunkCount: 2,
      byteSize: 10,
    } as const;
    manager.notifyRecording(RECORDING_ID, saved);
    expect(port.posted).toContainEqual(saved);
    // The toolbar shortcut stops it, as for any paused recording.
    expect(manager.toggle(1)).toBe(true);
    expect(port.posted).toContainEqual({ type: 'command', command: 'stop' });
    // Losing the tab leaves nothing to interrupt.
    port.disconnectFromOtherSide();
    await flush();
    expect(timers).toHaveLength(0);
    expect(finalize).not.toHaveBeenCalled();
  });

  it('ignores a disconnect from a port that was already replaced and tabs without a recording', async () => {
    const { timers, connectTab } = setup();
    const first = connectTab(1);
    first.receive({ type: 'snapshot', snapshot: snapshot({ recordingId: null }) });
    connectTab(1);
    first.disconnectFromOtherSide();
    await flush();
    expect(timers).toHaveLength(0);
  });

  it('uses default grace, warn and clock when not provided', async () => {
    store = openChunkStore(`manager-${++counter}`);
    const timers: number[] = [];
    const manager = createRecordingManager({
      store,
      loadSettings: async () => getDefaultSettings(),
      finalize: async () => undefined,
      onSnapshotsChanged: () => undefined,
      setTimeout: (_handler, ms) => timers.push(ms),
    });
    const port = createFakePort('zen-recorder:tab', { tab: { id: 1 } } as never);
    manager.handlePort(port);
    port.receive('garbage');
    port.receive({ type: 'snapshot', snapshot: snapshot() });
    const before = Date.now();
    port.receive(chunkOf(0, 'x', 0));
    await vi.waitFor(async () =>
      expect((await store.getChunks(RECORDING_ID))[0]?.receivedAt).toBeGreaterThanOrEqual(before),
    );
    port.disconnectFromOtherSide();
    await vi.waitFor(() => expect(timers).toEqual([10_000]));
  });
});
