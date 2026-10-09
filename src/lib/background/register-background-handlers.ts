/** Request/response handlers the popup and options pages call on the background. */
import type { DiagnosticsLog } from '@/lib/background/create-diagnostics-log';
import type { RecordingManager } from '@/lib/background/create-recording-manager';
import { isAbandonedRecording } from '@/lib/background/is-abandoned-recording';
import { isRecoveredRecording } from '@/lib/background/is-recovered-recording';
import { type ShowSavedFileDeps, showSavedFile } from '@/lib/background/show-saved-file';
import type { getExtensionMessaging } from '@/lib/messaging/get-extension-messaging';
import type { ChunkStore } from '@/lib/storage/open-chunk-store';
import type { RecordingMeta, Settings } from '@/lib/types';

export interface BackgroundHandlersDeps {
  onMessage: ReturnType<typeof getExtensionMessaging>['onMessage'];
  manager: RecordingManager;
  store: ChunkStore;
  loadSettings: () => Promise<Settings>;
  saveSettings: (patch: unknown) => Promise<Settings>;
  finalize: (
    recordingId: string,
    options: { recovered: boolean },
  ) => Promise<RecordingMeta | undefined>;
  downloads: ShowSavedFileDeps;
  /** Named diagnostics `debugProbe` runs; a page reaches them only in a test build. */
  probes?: Record<string, () => Promise<unknown>>;
  diagnostics?: Pick<DiagnosticsLog, 'list' | 'clear'>;
  /** The clock a recording left `recording` is judged by. Default `Date.now`. */
  now?: () => number;
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
  onMessage('sendCommand', ({ data }) => manager.sendCommand(data.tabId, data.command));
  onMessage('deleteRecording', ({ data }) => store.deleteRecording(data.id));
  onMessage('retryFinalize', async ({ data }) => {
    const meta = await store.getRecording(data.id);
    if (meta?.status === 'recording') await interruptAbandoned(meta);
    // Read from the recording, not its status: a recovered save that failed is `failed`.
    await deps.finalize(data.id, { recovered: meta !== undefined && isRecoveredRecording(meta) });
  });
  onMessage('showDownload', async ({ data }) => {
    const meta = await store.getRecording(data.id);
    // The popup shows the reason: a click that does nothing tells the person nothing.
    if (meta?.filename === undefined) throw new Error('this recording has no saved file');
    await showSavedFile(meta.filename, deps.downloads);
  });
  onMessage('updateSettings', ({ data }) => deps.saveSettings(data));
  onMessage('getDiagnostics', () => deps.diagnostics?.list() ?? []);
  onMessage('clearDiagnostics', () => deps.diagnostics?.clear());
  onMessage('debugProbe', async ({ data }) => {
    const probe = deps.probes?.[data.name];
    if (!probe) return { error: `unknown probe: ${data.name}` };
    try {
      return await probe();
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) };
    }
  });
}
