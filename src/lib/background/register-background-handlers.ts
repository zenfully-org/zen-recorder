/** Request/response handlers the popup and options pages call on the background. */
import type { Browser } from 'wxt/browser';
import type { DiagnosticsLog } from '@/lib/background/create-diagnostics-log';
import type { RecordingManager } from '@/lib/background/create-recording-manager';
import { isAbandonedRecording } from '@/lib/background/is-abandoned-recording';
import { isRecoveredRecording } from '@/lib/background/is-recovered-recording';
import { type ShowSavedFileDeps, showSavedFile } from '@/lib/background/show-saved-file';
import type { getExtensionMessaging } from '@/lib/messaging/get-extension-messaging';
import { parseProbeRequest } from '@/lib/protocol/parse-probe-request';
import { parseRecordingRequest } from '@/lib/protocol/parse-recording-request';
import { parseTabCommandRequest } from '@/lib/protocol/parse-tab-command-request';
import type { ChunkStore } from '@/lib/storage/open-chunk-store';
import type { EventStore } from '@/lib/storage/open-event-store';
import type { RecordingMeta, Settings } from '@/lib/types';

export interface BackgroundHandlersDeps {
  onMessage: ReturnType<typeof getExtensionMessaging>['onMessage'];
  manager: RecordingManager;
  store: ChunkStore;
  events: EventStore;
  loadSettings: () => Promise<Settings>;
  saveSettings: (patch: unknown) => Promise<Settings>;
  finalize: (
    recordingId: string,
    options: { recovered: boolean },
  ) => Promise<RecordingMeta | undefined>;
  /** Writes a saved recording's meeting notes, and resolves once they are written or failed. */
  writeNotes: (recordingId: string) => Promise<void>;
  downloads: ShowSavedFileDeps;
  /**
   * Named diagnostics `debugProbe` runs; a page reaches them only in a test build. Each gets the
   * message's sender, which names the tab that asked.
   */
  probes?: Record<string, (sender: Browser.runtime.MessageSender) => Promise<unknown>>;
  diagnostics?: Pick<DiagnosticsLog, 'list' | 'clear'>;
  /** The clock a recording left `recording` is judged by. Default `Date.now`. */
  now?: () => number;
}

/**
 * Why a request is refused when its data is not what the protocol says: the pages and content
 * scripts that send them are this extension's own, but what arrives is checked like any input.
 */
const MALFORMED = 'the request is malformed';

/** The recording a popup request is about, or a refusal the popup shows under it. */
function recordingIdOf(data: unknown): string {
  const request = parseRecordingRequest(data);
  if (!request) throw new Error(MALFORMED);
  return request.id;
}

export function registerBackgroundHandlers(deps: BackgroundHandlersDeps): void {
  const { onMessage, manager, store } = deps;
  const now = deps.now ?? (() => Date.now());
  /**
   * A recording left `recording` is saved only once no page can deliver it any more, and marked
   * interrupted first, as the recovery pass does: its file is a recovered one.
   */
  const interruptAbandoned = async (meta: RecordingMeta): Promise<void> => {
    const claimedIds = new Set(manager.claimedRecordingIds());
    if (!isAbandonedRecording(meta, { claimedIds, now: now() })) {
      throw new Error('its meeting tab may still deliver it');
    }
    await store.updateRecording(meta.id, { status: 'interrupted', endedAt: now() });
  };
  onMessage('getOverview', async () => ({
    tabs: manager.tabs(),
    recordings: await store.listRecordings(),
    settings: await deps.loadSettings(),
  }));
  onMessage('sendCommand', ({ data }) => {
    const request = parseTabCommandRequest(data);
    if (!request) throw new Error(MALFORMED);
    manager.sendCommand(request.tabId, request.command);
  });
  // Its meeting events go with it: nothing else would ever use them.
  onMessage('deleteRecording', async ({ data }) => {
    const id = recordingIdOf(data);
    await store.deleteRecording(id);
    await deps.events.deleteEvents(id);
  });
  onMessage('retryFinalize', async ({ data }) => {
    const id = recordingIdOf(data);
    const meta = await store.getRecording(id);
    // Its file is on disk, and a second save would be a second copy: only its notes are retried.
    if (meta?.status === 'saved') return deps.writeNotes(id);
    if (meta?.status === 'recording') await interruptAbandoned(meta);
    // Read from the recording, not its status: a recovered save that failed is `failed`.
    await deps.finalize(id, { recovered: meta !== undefined && isRecoveredRecording(meta) });
  });
  onMessage('showDownload', async ({ data }) => {
    const meta = await store.getRecording(recordingIdOf(data));
    // The popup shows the reason: a click that does nothing tells the person nothing.
    if (meta?.filename === undefined) throw new Error('this recording has no saved file');
    await showSavedFile(meta.filename, deps.downloads);
  });
  onMessage('updateSettings', ({ data }) => deps.saveSettings(data));
  onMessage('getDiagnostics', () => deps.diagnostics?.list() ?? []);
  onMessage('clearDiagnostics', () => deps.diagnostics?.clear());
  onMessage('debugProbe', async ({ data, sender }) => {
    const request = parseProbeRequest(data);
    if (!request) return { error: MALFORMED };
    const probe = deps.probes?.[request.name];
    if (!probe) return { error: `unknown probe: ${request.name}` };
    try {
      return await probe(sender);
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) };
    }
  });
}
