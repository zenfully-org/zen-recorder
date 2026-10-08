/** Request/response handlers the popup and options pages call on the background. */
import type { DiagnosticsLog } from '@/lib/background/create-diagnostics-log';
import type { RecordingManager } from '@/lib/background/create-recording-manager';
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
  downloads: { show: (id: number) => Promise<void> };
  /** Named diagnostics `debugProbe` runs; a page reaches them only in a test build. */
  probes?: Record<string, () => Promise<unknown>>;
  diagnostics?: Pick<DiagnosticsLog, 'list' | 'clear'>;
}

export function registerBackgroundHandlers(deps: BackgroundHandlersDeps): void {
  const { onMessage, manager, store } = deps;
  onMessage('getOverview', async () => ({
    tabs: manager.tabs(),
    recordings: await store.listRecordings(),
    settings: await deps.loadSettings(),
  }));
  onMessage('sendCommand', ({ data }) => manager.sendCommand(data.tabId, data.command));
  onMessage('deleteRecording', ({ data }) => store.deleteRecording(data.id));
  onMessage('retryFinalize', async ({ data }) => {
    const meta = await store.getRecording(data.id);
    await deps.finalize(data.id, { recovered: meta?.status === 'interrupted' });
  });
  onMessage('showDownload', async ({ data }) => {
    const meta = await store.getRecording(data.id);
    // The popup shows the reason: a click that does nothing tells the person nothing.
    if (meta?.downloadId === undefined) throw new Error('this recording has no saved file');
    await deps.downloads.show(meta.downloadId);
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
