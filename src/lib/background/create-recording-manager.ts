/**
 * Background side of the recorder: tracks connected Meet tabs, persists their chunks, triggers
 * finalization when a recording ends, and hands a lost tab's recordings to `createLostTabs`.
 */
import type { Browser } from 'wxt/browser';
import { createLogReceipts, type ReceivedLog } from '@/lib/background/create-log-receipts';
import { createLostTabs } from '@/lib/background/create-lost-tabs';
import { createRecordingStarts } from '@/lib/background/create-recording-starts';
import { createRecordingTabs } from '@/lib/background/create-recording-tabs';
import { createStoreAlerts } from '@/lib/background/create-store-alerts';
import { recordingEndPatch } from '@/lib/background/recording-end-patch';
import { recordingsClaimedBy } from '@/lib/background/recordings-claimed-by';
import { storeMeetingEvents } from '@/lib/background/store-meeting-events';
import { parseTabToBackground } from '@/lib/protocol/parse-tab-to-background';
import type { ChunkStore } from '@/lib/storage/open-chunk-store';
import type { EventStore } from '@/lib/storage/open-event-store';
import type {
  BackgroundToTab,
  ChunkMessage,
  LifecycleCommand,
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
  /** The browser closed tab `tabId` (`tabs.onRemoved`): a recording it lost the end of is saved. */
  tabClosed(tabId: number): void;
  tabs(): { tabId: number; snapshot: TabSnapshot }[];
  snapshots(): TabSnapshot[];
  claimedRecordingIds(): string[];
  sendCommand(tabId: number, command: LifecycleCommand): void;
  /** Stop if the tab is recording/paused, otherwise start. Returns false if the tab is unknown. */
  toggle(tabId: number): boolean;
  broadcastSettings(settings: Settings): void;
  /** Posts `message` to the tab the recording comes from, while it is connected. */
  notifyRecording(recordingId: string, message: BackgroundToTab): void;
}

export interface RecordingManagerDeps {
  store: ChunkStore;
  /** The recordings' meeting events, in a database of their own. */
  events: EventStore;
  loadSettings: () => Promise<Settings>;
  finalize: (
    recordingId: string,
    options: { recovered: boolean },
  ) => Promise<RecordingMeta | undefined>;
  onSnapshotsChanged: (snapshots: TabSnapshot[]) => void;
  /** Called once a recording's metadata has been stored (e.g. to check disk headroom). */
  onRecordingStarted?: (info: RecordingStartedInfo) => void;
  /** Log lines relayed from the Meet page (kept in the diagnostics log). */
  /** A page's log line, once: `at` is when its bridge got it. */
  onLog?: (log: ReceivedLog, tabId: number) => void;
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
type QueuedMessage = Exclude<TabToBackground, { type: 'hello' | 'snapshot' | 'log' }>;

const describeMessage = (message: QueuedMessage): string =>
  message.type === 'chunk'
    ? `chunk ${message.chunk.seq} of ${message.chunk.recordingId}`
    : message.type;

const post = (tab: TabConnection, message: BackgroundToTab): void => {
  try {
    tab.port.postMessage(message);
  } catch {
    /* port already gone; onDisconnect cleans up */
  }
};

/**
 * Stores a chunk and counts it in its recording (`meta`, as stored, if it is), or drops a chunk of
 * a recording that is no longer recording. Either way the chunk is acked once this returns.
 */
const storeChunk = async (
  deps: RecordingManagerDeps,
  chunk: ChunkMessage,
  {
    meta,
    now,
    warn,
  }: { meta: RecordingMeta | undefined; now: () => number; warn: (message: string) => void },
): Promise<void> => {
  if (meta && meta.status !== 'recording') {
    // The file was already written (e.g. finalized as recovered); appending late chunks
    // would produce a second, headerless file. Ack so the page moves on, keep nothing.
    warn(`dropping chunk ${chunk.seq} of ${chunk.recordingId}: already ${meta.status}`);
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
};

/** Why a command found no tab; the popup shows it, as its card for the tab outlived the tab. */
const TAB_GONE =
  'the meeting tab is no longer connected (it was closed, reloaded or left the meeting)';

export function createRecordingManager(deps: RecordingManagerDeps): RecordingManager {
  const graceMs = deps.interruptGraceMs ?? 10_000;
  const warn = deps.warn ?? (() => undefined);
  const now = deps.now ?? (() => Date.now());
  const connections = new Map<number, TabConnection>();
  const starts = createRecordingStarts({ ...deps, warn });
  const alerts = createStoreAlerts();
  const logs = createLogReceipts(deps.onLog);
  const recordingTabs = createRecordingTabs((tabId) => connections.get(tabId));

  const snapshots = (): TabSnapshot[] => [...connections.values()].flatMap((t) => t.snapshot ?? []);

  const lostTabs = createLostTabs({
    ...deps,
    graceMs,
    now,
    warn,
    claimedNow: () => recordingsClaimedBy(snapshots()),
    isConnected: (tabId) => connections.has(tabId),
  });

  const onDisconnect = (tab: TabConnection): void => {
    if (connections.get(tab.tabId) === tab) connections.delete(tab.tabId);
    deps.onSnapshotsChanged(snapshots());
    lostTabs.lost(tab);
  };

  /**
   * The page sends the end until it is acked, like a chunk: it is acked once `ended` is stored,
   * and a second one (its ack was lost) is acked and ignored.
   */
  const endRecording = async (tab: TabConnection, info: RecordingEndedInfo): Promise<void> => {
    const { recordingId } = info;
    const endAck: BackgroundToTab = { type: 'endAck', recordingId };
    // The end carries the recording's announcement: one sent while the Port was down never came.
    const meta = await starts.stored(recordingId, info.started);
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
    await deps.store.updateRecording(recordingId, recordingEndPatch(info, now()));
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
        await storeChunk(deps, chunk, { meta, now, warn });
        post(tab, { type: 'ack', recordingId: chunk.recordingId, seq: chunk.seq });
        return;
      }
      case 'recordingEnded':
        await endRecording(tab, message.info);
        return;
      case 'events':
        post(tab, await storeMeetingEvents(deps, message.batch, { now, warn }));
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
        // At once, not behind the chunks: a log line waits for no store, and its ack frees it.
        if (message.type === 'log')
          return logs.receive(tab.tabId, message, (ack) => post(tab, ack));
        recordingTabs.claim(tab.tabId, message);
        // A store failure is told to the tab that sent the message, the one whose recording it is.
        tab.queue = tab.queue
          .then(() => onTabMessage(tab, message))
          .then(() => alerts.stored(tab.tabId, message))
          .catch((error: unknown) => {
            warn(`could not handle ${describeMessage(message)} from tab ${tab.tabId}:`, error);
            const alert = alerts.failed(tab.tabId, message, error);
            if (alert) post(tab, alert);
          });
      });
      port.onDisconnect.addListener(() => onDisconnect(tab));
      // Not awaited: settings that cannot be read go to Diagnostics, and the tab keeps its own.
      void deps.loadSettings().then(
        (settings) => post(tab, { type: 'settings', settings }),
        (error: unknown) => warn(`could not send the settings to tab ${tab.tabId}:`, error),
      );
    },
    tabClosed: (tabId) => lostTabs.closed(tabId),
    tabs: () =>
      [...connections.values()].flatMap((t) =>
        t.snapshot ? [{ tabId: t.tabId, snapshot: t.snapshot }] : [],
      ),
    snapshots,
    claimedRecordingIds: () => recordingsClaimedBy(snapshots()),
    sendCommand(tabId, command) {
      const tab = connections.get(tabId);
      if (!tab) throw new Error(TAB_GONE);
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
      const tab = recordingTabs.tabOf(recordingId);
      if (tab) post(tab, message);
    },
  };
}
