/**
 * ISOLATED-world content script logic (the bridge): validates everything the MAIN-world recorder
 * sends, relays chunks and state to the background over a Port, pushes settings into the page and
 * drives the REC overlay.
 *
 * When the page goes away (a navigation, a closed tab), the page's own end of a recording never
 * leaves it: its messages are delivered in later tasks, which a page being unloaded does not run.
 * So the bridge ends, on `pagehide`, every recording whose end the background has not acked, on the
 * Port and behind the chunks it relayed.
 */
import type { BackgroundPort } from '@/lib/messaging/create-background-port';
import type { WindowMessenger } from '@/lib/page/create-window-messenger';
import { parseChunkMessage } from '@/lib/protocol/parse-chunk-message';
import { parsePageLog } from '@/lib/protocol/parse-page-log';
import { parseRecordingEnded } from '@/lib/protocol/parse-recording-ended';
import { parseRecordingStarted } from '@/lib/protocol/parse-recording-started';
import { parseTabSnapshot } from '@/lib/protocol/parse-tab-snapshot';
import { getDefaultSettings } from '@/lib/settings/get-default-settings';
import type {
  BackgroundToTab,
  LifecycleCommand,
  PageConfig,
  PageProtocolMap,
  Settings,
  TabSnapshot,
} from '@/lib/types';
import type { OverlayHandle } from '@/lib/ui/mount-overlay';

export interface Bridge {
  start(): Promise<void>;
  dispose(): void;
  getSnapshot(): TabSnapshot | null;
}

export interface BridgeDeps {
  messenger: WindowMessenger<PageProtocolMap>;
  createPort: (onMessage: (message: BackgroundToTab) => void) => BackgroundPort;
  loadSettings: () => Promise<Settings>;
  watchSettings: (listener: (settings: Settings) => void) => () => void;
  /** Calls `listener` on the window's `pagehide`; returns the function that removes it. */
  onPageHide: (listener: () => void) => () => void;
  mountOverlay: (onCommand: (command: LifecycleCommand) => void) => Promise<OverlayHandle | null>;
  setInterval: (handler: () => void, ms: number) => number;
  clearInterval: (id: number) => void;
  log: { info: (m: string) => void; warn: (m: string) => void; error: (m: string) => void };
  keepaliveMs?: number;
}

function toPageConfig(settings: Settings): PageConfig {
  return {
    autoRecord: settings.autoRecord,
    startRule: settings.startRule,
    audioBitsPerSecond: settings.audioBitsPerSecond,
    timesliceMs: settings.timesliceMs,
    videoMode: settings.videoMode,
    videoFps: settings.videoFps,
    videoHeight: settings.videoHeight,
    videoBitsPerSecond: settings.videoBitsPerSecond,
    videoLabels: settings.videoLabels,
    spoofVisibility: settings.spoofVisibility,
  };
}

export function createBridge(deps: BridgeDeps): Bridge {
  const { messenger } = deps;
  let overlay: OverlayHandle | null = null;
  let snapshot: TabSnapshot | null = null;
  let settings: Settings = getDefaultSettings();
  /**
   * Recordings whose end the background has not acked: how many chunks the page handed over, and
   * how far into the recording the last one reached.
   */
  const unended = new Map<string, { chunkCount: number; durationMs: number }>();
  const cleanups: (() => void)[] = [];

  const configurePage = (): void => {
    messenger.notify('bridge:configure', toPageConfig(settings));
  };

  const applySettings = (next: Settings): void => {
    settings = next;
    overlay?.setEnabled(next.overlayEnabled);
    configurePage();
  };

  const port = deps.createPort((message) => {
    switch (message.type) {
      case 'command':
        messenger.notify('bridge:command', { command: message.command });
        break;
      case 'settings':
        applySettings(message.settings);
        break;
      case 'saved':
        deps.log.info(
          `saved ${message.filename} (${message.chunkCount} chunks, ${message.byteSize} bytes raw)`,
        );
        overlay?.toast(`Recording saved: ${message.filename}`, 'ok');
        break;
      case 'error':
        overlay?.toast(`Zen Recorder error: ${message.message}`, 'error');
        break;
      case 'ack':
        break;
    }
  });

  const sendCommand = (command: LifecycleCommand): void => {
    messenger.notify('bridge:command', { command });
  };

  /**
   * Runs inside `pagehide`, while the Port still delivers: Port messages arrive in order, so the
   * background stores the chunks relayed so far first. Nothing waits for the acks.
   */
  const endUnended = (): void => {
    for (const [recordingId, { chunkCount, durationMs }] of unended) {
      const message = `the page went away: recording ${recordingId} ended (pagehide) after ${chunkCount} chunks`;
      deps.log.info(message);
      port.send({ type: 'log', log: { level: 'info', message } });
      port.send({
        type: 'recordingEnded',
        info: { recordingId, chunkCount, durationMs, reason: 'pagehide' },
      });
    }
    unended.clear();
  };

  return {
    async start() {
      settings = await deps.loadSettings();
      port.connect();
      cleanups.push(
        messenger.onMessage('page:ready', configurePage),
        messenger.onMessage('page:snapshot', ({ data }) => {
          const parsed = parseTabSnapshot(data);
          if (!parsed) return;
          snapshot = parsed;
          port.send({ type: 'snapshot', snapshot: parsed });
          overlay?.update(parsed);
        }),
        messenger.onMessage('page:recordingStarted', ({ data }) => {
          const parsed = parseRecordingStarted(data);
          if (!parsed) return;
          port.send({ type: 'recordingStarted', info: parsed });
          // Re-announced whenever a bridge configures the page: keep what was counted.
          if (!unended.has(parsed.recordingId)) {
            unended.set(parsed.recordingId, { chunkCount: 0, durationMs: 0 });
          }
        }),
        messenger.onMessage('page:chunk', async ({ data }) => {
          const parsed = parseChunkMessage(data);
          if (!parsed) throw new Error('malformed chunk');
          const counted = unended.get(parsed.recordingId);
          unended.set(parsed.recordingId, {
            chunkCount: Math.max(counted?.chunkCount ?? 0, parsed.seq + 1),
            durationMs: Math.max(counted?.durationMs ?? 0, parsed.timestampMs),
          });
          await port.sendChunk(parsed);
          return { ok: true } as const;
        }),
        // Answered only once the background stored it, so the page sends it again when the Port
        // was down or the event page restarted on the way. An older page session ignores
        // the answer.
        messenger.onMessage('page:recordingEnded', async ({ data }) => {
          const parsed = parseRecordingEnded(data);
          if (!parsed) throw new Error('malformed end notice');
          await port.sendEnd(parsed);
          unended.delete(parsed.recordingId);
          return { ok: true } as const;
        }),
        messenger.onMessage('page:log', ({ data }) => {
          const parsed = parsePageLog(data);
          if (!parsed) return;
          deps.log[parsed.level](parsed.message);
          port.send({ type: 'log', log: parsed });
        }),
        deps.watchSettings(applySettings),
        deps.onPageHide(endUnended),
      );
      // The page may have signalled ready before our listeners existed.
      configurePage();
      const keepalive = deps.setInterval(() => {
        if (snapshot && snapshot.state !== 'idle') port.send({ type: 'ping' });
      }, deps.keepaliveMs ?? 20_000);
      cleanups.push(() => deps.clearInterval(keepalive));
      overlay = await deps.mountOverlay(sendCommand);
      overlay?.setEnabled(settings.overlayEnabled);
      if (snapshot) overlay?.update(snapshot);
    },
    dispose() {
      for (const cleanup of cleanups.splice(0)) cleanup();
      port.close();
      overlay?.destroy();
      overlay = null;
    },
    getSnapshot: () => snapshot,
  };
}
