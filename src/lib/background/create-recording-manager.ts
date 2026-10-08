/**
 * Background side of the recorder: tracks connected Meet tabs, persists their chunks, triggers
 * finalization when a recording ends, and treats a lost tab as an interrupted recording.
 */
import type { Browser } from 'wxt/browser';
import { createRecordingStarts } from '@/lib/background/create-recording-starts';
import { recordingsClaimedBy } from '@/lib/background/recordings-claimed-by';
import { parseTabToBackground } from '@/lib/protocol/parse-tab-to-background';
import type { ChunkStore } from '@/lib/storage/open-chunk-store';
import type {
  BackgroundToTab,
  LifecycleCommand,
  PageLog,
  RecordingEndedInfo,
  RecordingMeta,
  RecordingStartedInfo,
  Settings,
  TabSnapshot,
  TabToBackground,
} from '@/lib/types';

export interface RecordingManager {
  /** Attach a freshly connected tab port (already filtered by name). */
  handlePort(port: Browser.runtime.Port): void;
  tabs(): { tabId: number; snapshot: TabSnapshot }[];
  snapshots(): TabSnapshot[];
  claimedRecordingIds(): string[];
  sendCommand(tabId: number, command: LifecycleCommand): void;
  /** Stop if the tab is recording/paused, otherwise start. Returns false if the tab is unknown. */
  toggle(tabId: number): boolean;
  broadcastSettings(settings: Settings): void;
  notifyRecording(recordingId: string, message: BackgroundToTab): void;
}

export interface RecordingManagerDeps {
  store: ChunkStore;
  loadSettings: () => Promise<Settings>;
  finalize: (
    recordingId: string,
    options: { recovered: boolean },
  ) => Promise<RecordingMeta | undefined>;
  onSnapshotsChanged: (snapshots: TabSnapshot[]) => void;
  /** Called once a recording's metadata has been stored (e.g. to check disk headroom). */
  onRecordingStarted?: (info: RecordingStartedInfo) => void;
  /** Log lines relayed from the Meet page (kept in the diagnostics log). */
  onLog?: (log: PageLog, tabId: number) => void;
  setTimeout: (handler: () => void, ms: number) => unknown;
  interruptGraceMs?: number;
  warn?: (message: string, detail?: unknown) => void;
  now?: () => number;
}

interface TabConnection {
  tabId: number;
  port: Browser.runtime.Port;
  snapshot: TabSnapshot | null;
  /**
   * Messages from one tab are handled strictly in order (running totals depend on it). It never
   * rejects: a message that failed is logged, and the next one runs. Nothing slow runs in
   * it: a recording that ended is finalized outside it.
   */
  queue: Promise<void>;
}

/** The messages that go through a tab's queue (state updates are applied at once). */
type QueuedMessage = Exclude<TabToBackground, { type: 'hello' | 'snapshot' }>;

const describeMessage = (message: QueuedMessage): string =>
  message.type === 'chunk'
    ? `chunk ${message.chunk.seq} of ${message.chunk.recordingId}`
    : message.type;

export function createRecordingManager(deps: RecordingManagerDeps): RecordingManager {
  const graceMs = deps.interruptGraceMs ?? 10_000;
  const warn = deps.warn ?? (() => undefined);
  const now = deps.now ?? (() => Date.now());
  const connections = new Map<number, TabConnection>();
  const starts = createRecordingStarts({ ...deps, warn });

  const snapshots = (): TabSnapshot[] => [...connections.values()].flatMap((t) => t.snapshot ?? []);

  const post = (tab: TabConnection, message: BackgroundToTab): void => {
    try {
      tab.port.postMessage(message);
    } catch {
      /* port already gone; onDisconnect cleans up */
    }
  };

  const interrupt = async (recordingId: string, drainedAt: number): Promise<void> => {
    const meta = await deps.store.getRecording(recordingId);
    if (meta?.status !== 'recording') return;
    // A port that dropped delivers nothing more, so a chunk stored after the lost tab's queue
    // drained came through another port: the page is alive, not an orphan.
    if (meta.lastChunkAt !== undefined && meta.lastChunkAt > drainedAt) return;
    await deps.store.updateRecording(recordingId, { status: 'interrupted', endedAt: now() });
    await deps.finalize(recordingId, { recovered: true });
  };

  const onDisconnect = (tab: TabConnection): void => {
    if (connections.get(tab.tabId) === tab) connections.delete(tab.tabId);
    deps.onSnapshotsChanged(snapshots());
    // The recording it wrote, and the stopped ones whose chunks it still held.
    const claimed = recordingsClaimedBy([tab.snapshot]);
    if (claimed.length === 0) return;
    // The grace starts once the tab's queue has drained. A tab that dies without ending its
    // recording (a crash) can leave chunks in it that are stored after the port dropped. Counted
    // as chunks still arriving, they would leave the recording unsaved until the next background
    // start, and saving it before they are stored would leave them out of the file.
    void tab.queue.then(() => {
      const drainedAt = now();
      // The page may reconnect (event page restart, content script reload). Give it a moment.
      deps.setTimeout(() => {
        const reconnected = recordingsClaimedBy(snapshots());
        for (const recordingId of claimed.filter((id) => !reconnected.includes(id))) {
          // When the store fails (a full disk, a closed database), the recording keeps its chunks
          // and stays unsaved: the recovery pass of the next background start saves it.
          void interrupt(recordingId, drainedAt).catch((error: unknown) =>
            warn(`could not interrupt ${recordingId}:`, error),
          );
        }
      }, graceMs);
    });
  };

  /**
   * The page sends the end until it is acked, like a chunk: it is acked once `ended` is stored,
   * and a second one (its ack was lost) is acked and ignored.
   */
  const endRecording = async (tab: TabConnection, info: RecordingEndedInfo): Promise<void> => {
    const { recordingId } = info;
    const endAck: BackgroundToTab = { type: 'endAck', recordingId };
    const meta = await starts.stored(recordingId);
    if (!meta && starts.pending(recordingId)) {
      // Not acked: the page sends the end again, as after any store failure.
      warn(
        `recording ${recordingId} ended, but its start still cannot be stored, so no file is saved yet; the meeting tab sends the end again until it is (a closed tab cannot)`,
      );
      return;
    }
    if (!meta) {
      // Acked: a page announces only the recording it runs, so nothing can bring this one back.
      warn(
        `no file is saved for recording ${recordingId}: it ended, but nothing about it is stored (it was removed from the list, or its start never reached storage)`,
      );
      post(tab, endAck);
      return;
    }
    if (meta.status !== 'recording') {
      warn(`ignoring end of ${recordingId}: already ${meta.status}`);
      post(tab, endAck);
      return;
    }
    // Chunks the end counts that were never stored (the page went away before the bridge
    // relayed them, or the store failed): no chunk follows an end, so it is saved without them.
    if (info.chunkCount > meta.chunkCount) {
      warn(
        `end of ${recordingId} (${info.reason}) counts ${info.chunkCount} chunks, ${meta.chunkCount} stored: the file ends early`,
      );
    }
    await deps.store.updateRecording(recordingId, {
      status: 'ended',
      endedAt: now(),
      durationMs: info.durationMs,
    });
    post(tab, endAck);
    // Not awaited: an hour of video takes 15-42 s to remux and save, and the tab's next
    // recording must be stored meanwhile. Late chunks of this one are dropped (no longer
    // `recording`), and the save queue keeps its file apart from the next one's.
    void deps
      .finalize(recordingId, { recovered: false })
      .catch((error: unknown) => warn(`could not finalize ${recordingId}:`, error));
  };

  const onTabMessage = async (tab: TabConnection, message: QueuedMessage): Promise<void> => {
    switch (message.type) {
      case 'recordingStarted':
        await starts.announce(message.info);
        return;
      case 'chunk': {
        const { chunk } = message;
        // A start the store refused is tried again with each chunk, which is stored either way.
        const meta = await starts.stored(chunk.recordingId);
        if (meta && meta.status !== 'recording') {
          // The file was already written (e.g. finalized as recovered); appending late chunks
          // would produce a second, headerless file. Ack so the page moves on, keep nothing.
          warn(`dropping chunk ${chunk.seq} of ${chunk.recordingId}: already ${meta.status}`);
          post(tab, { type: 'ack', recordingId: chunk.recordingId, seq: chunk.seq });
          return;
        }
        // A chunk is acked only once it is stored and counted. When the store fails (a full disk, a
        // closed database) the page gets no ack and sends the chunk again; storing it twice
        // overwrites the same key, and the totals were not updated for the failed attempt.
        await deps.store.putChunk({
          recordingId: chunk.recordingId,
          seq: chunk.seq,
          blob: chunk.blob,
          byteLength: chunk.blob.size,
          receivedAt: now(),
        });
        if (meta) {
          // The page sends a recording's chunks in order, the next only once this one is acked,
          // so a seq below the count was counted already: its first send was late, not lost, and
          // the page sent it again after the ack timeout. Its arrival still says the page is alive.
          const counted = chunk.seq < meta.chunkCount;
          await deps.store.updateRecording(
            chunk.recordingId,
            counted
              ? { lastChunkAt: now() }
              : {
                  chunkCount: chunk.seq + 1,
                  byteSize: meta.byteSize + chunk.blob.size,
                  durationMs: chunk.timestampMs,
                  lastChunkAt: now(),
                },
          );
        }
        post(tab, { type: 'ack', recordingId: chunk.recordingId, seq: chunk.seq });
        return;
      }
      case 'recordingEnded':
        await endRecording(tab, message.info);
        return;
      case 'log':
        deps.onLog?.(message.log, tab.tabId);
        return;
      case 'ping':
        return;
    }
  };

  return {
    handlePort(port) {
      const tabId = port.sender?.tab?.id;
      if (tabId === undefined) {
        port.disconnect();
        return;
      }
      const existing = connections.get(tabId);
      const tab: TabConnection = {
        tabId,
        port,
        snapshot: existing?.snapshot ?? null,
        queue: Promise.resolve(),
      };
      connections.set(tabId, tab);
      port.onMessage.addListener((raw: unknown) => {
        const message = parseTabToBackground(raw);
        if (!message) {
          warn('ignoring malformed tab message', raw);
          return;
        }
        if (message.type === 'hello' || message.type === 'snapshot') {
          // State updates are synchronous so the badge/popup never lag behind storage work.
          tab.snapshot = message.snapshot;
          deps.onSnapshotsChanged(snapshots());
          return;
        }
        tab.queue = tab.queue
          .then(() => onTabMessage(tab, message))
          .catch((error: unknown) =>
            warn(`could not handle ${describeMessage(message)} from tab ${tab.tabId}:`, error),
          );
      });
      port.onDisconnect.addListener(() => onDisconnect(tab));
      void deps.loadSettings().then((settings) => post(tab, { type: 'settings', settings }));
    },
    tabs: () =>
      [...connections.values()].flatMap((t) =>
        t.snapshot ? [{ tabId: t.tabId, snapshot: t.snapshot }] : [],
      ),
    snapshots,
    claimedRecordingIds: () => recordingsClaimedBy(snapshots()),
    sendCommand(tabId, command) {
      const tab = connections.get(tabId);
      if (!tab) throw new Error(`no meeting tab with id ${tabId}`);
      post(tab, { type: 'command', command });
    },
    toggle(tabId) {
      const tab = connections.get(tabId);
      if (!tab?.snapshot) return false;
      const active = tab.snapshot.state === 'recording' || tab.snapshot.state === 'paused';
      post(tab, { type: 'command', command: active ? 'stop' : 'start' });
      return true;
    },
    broadcastSettings(settings) {
      for (const tab of connections.values()) post(tab, { type: 'settings', settings });
    },
    notifyRecording(recordingId, message) {
      for (const tab of connections.values()) {
        const id = tab.snapshot?.recordingId;
        if (id === recordingId || id === null) post(tab, message);
      }
    },
  };
}
