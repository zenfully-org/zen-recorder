/**
 * ISOLATED-world content script logic (the bridge): validates everything the MAIN-world recorder
 * sends, relays chunks and state to the background over a Port, pushes settings into the page and
 * drives the REC overlay.
 *
 * When the page goes away (a navigation, a closed tab), the page's own end of a recording never
 * leaves it: its messages are delivered in later tasks, which a page being unloaded does not run.
 * So the page hands the bridge what it still holds inside `pagehide`, by a DOM event that arrives in
 * the same task (`page:handover`), and the bridge relays it on the Port there. When the tab's
 * content process shuts down with it, Firefox interrupts the page's script once, wherever it is,
 * which can stop the page's `pagehide` listener short; so the bridge asks again from its own
 * (`bridge:handover`), and relays only what is new. A page session older than that hands nothing
 * over: for it, and for any recording the handover leaves without an end, the bridge ends, on
 * `pagehide`, every recording whose end the background has not acked, on the Port and behind the
 * chunks it relayed.
 */
import { createRelayLedger } from '@/lib/bridge/create-relay-ledger';
import { endUnended } from '@/lib/bridge/end-unended';
import { relayEvents } from '@/lib/bridge/relay-events';
import { relayHandover } from '@/lib/bridge/relay-handover';
import type { BackgroundPort } from '@/lib/messaging/create-background-port';
import type { PageMessenger } from '@/lib/page/create-page-messenger';
import { parseChunkMessage } from '@/lib/protocol/parse-chunk-message';
import { parsePageHandover } from '@/lib/protocol/parse-page-handover';
import { parsePageLog } from '@/lib/protocol/parse-page-log';
import { parseRecordingEnded } from '@/lib/protocol/parse-recording-ended';
import { parseRecordingStarted } from '@/lib/protocol/parse-recording-started';
import { parseTabSnapshot } from '@/lib/protocol/parse-tab-snapshot';
import { getDefaultSettings } from '@/lib/settings/get-default-settings';
import type {
  BackgroundToTab,
  LifecycleCommand,
  PageConfig,
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
  messenger: PageMessenger;
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
  /** Tells this bridge from the one before it in the page (an extension reload). */
  bridgeId: string;
}

function toPageConfig(settings: Settings, bridgeId: string): PageConfig {
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
    // The page sends `page:events` only to a bridge that says it takes them.
    eventsProtocol: 1,
    bridgeId,
    meetingNotes: settings.meetingNotes,
  };
}

export function createBridge(deps: BridgeDeps): Bridge {
  const { messenger } = deps;
  let overlay: OverlayHandle | null = null;
  let snapshot: TabSnapshot | null = null;
  let settings: Settings = getDefaultSettings();
  /** Each recording's chunks and end: counted, acked, on their way. */
  const ledger = createRelayLedger();
  const cleanups: (() => void)[] = [];

  const configurePage = (): void => {
    messenger.notify('bridge:configure', toPageConfig(settings, deps.bridgeId));
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
    }
  });

  const relay = { ledger, port, log: deps.log.info };

  const sendCommand = (command: LifecycleCommand): void => {
    messenger.notify('bridge:command', { command });
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
          ledger.started(parsed);
        }),
        messenger.onMessage('page:chunk', async ({ data }) => {
          const parsed = parseChunkMessage(data);
          if (!parsed) throw new Error('malformed chunk');
          await ledger.relay(parsed, () => port.sendChunk(parsed));
          return { ok: true } as const;
        }),
        // Answered only once the background stored it, so the page sends it again when the Port
        // was down or the event page restarted on the way. An older page session ignores
        // the answer.
        messenger.onMessage('page:recordingEnded', async ({ data }) => {
          const parsed = parseRecordingEnded(data);
          if (!parsed) throw new Error('malformed end notice');
          await ledger.relayEnd(parsed, (end) => port.sendEnd(end));
          return { ok: true } as const;
        }),
        messenger.onMessage('page:events', ({ data }) => relayEvents(data, port, deps.log.warn)),
        messenger.onMessage('page:log', ({ data }) => {
          const parsed = parsePageLog(data);
          if (!parsed) return;
          deps.log[parsed.level](parsed.message);
          port.send({ type: 'log', log: parsed });
        }),
        // Inside the page's pagehide, before the bridge's own end below.
        messenger.onSync('page:handover', ({ data }) => {
          const handover = parsePageHandover(data);
          if (handover) relayHandover(handover, relay);
        }),
        deps.watchSettings(applySettings),
        deps.onPageHide(() => {
          messenger.notifySync('bridge:handover', undefined);
          endUnended(relay);
        }),
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
