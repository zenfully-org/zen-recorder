import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from '#imports';
import type { RecordingManager } from '@/lib/background/create-recording-manager';
import { getExtensionMessaging } from '@/lib/messaging/get-extension-messaging';
import { getDefaultSettings } from '@/lib/settings/get-default-settings';
import { type ChunkStore, openChunkStore } from '@/lib/storage/open-chunk-store';
import type { RecordingMeta } from '@/lib/types';
import { registerBackgroundHandlers } from './register-background-handlers';

let counter = 0;
let store: ChunkStore;

function meta(id: string, patch: Partial<RecordingMeta> = {}): RecordingMeta {
  return {
    id,
    meetingCode: 'c',
    title: 't',
    startedAt: 1,
    mimeType: 'm',
    status: 'saved',
    chunkCount: 0,
    byteSize: 0,
    ...patch,
  };
}

describe('registerBackgroundHandlers', () => {
  const manager = {
    tabs: vi.fn(() => [{ tabId: 1, snapshot: { state: 'idle' } }]),
    sendCommand: vi.fn(),
  } as unknown as RecordingManager;
  const finalize = vi.fn(async () => undefined);
  const downloads = { show: vi.fn(async (_id: number) => undefined) };
  const saveSettings = vi.fn(async () => getDefaultSettings());

  beforeEach(async () => {
    fakeBrowser.reset();
    vi.clearAllMocks();
    store = openChunkStore(`handlers-${++counter}`);
    await store.putRecording(meta('saved', { downloadId: 42 }));
    await store.putRecording(meta('interrupted', { status: 'interrupted' }));
    await store.putRecording(meta('failed', { status: 'failed' }));
    registerBackgroundHandlers({
      onMessage: getExtensionMessaging().onMessage,
      manager,
      store,
      loadSettings: async () => getDefaultSettings(),
      saveSettings,
      finalize,
      downloads,
      probes: {
        ok: async () => ({ fine: true }),
        boom: async () => {
          throw new Error('probe exploded');
        },
        weird: async () => {
          throw 'not an error';
        },
      },
    });
  });
  afterEach(async () => {
    getExtensionMessaging().removeAllListeners();
    await store.close();
  });

  const send = getExtensionMessaging().sendMessage;

  it('exposes and clears the diagnostics log, or empty values without one', async () => {
    await expect(send('getDiagnostics', undefined)).resolves.toEqual([]);
    await expect(send('clearDiagnostics', undefined)).resolves.toBeUndefined();
    getExtensionMessaging().removeAllListeners();
    const entries = [{ at: 1, level: 'info' as const, source: 'page', message: 'hi' }];
    const clear = vi.fn(async () => undefined);
    registerBackgroundHandlers({
      onMessage: getExtensionMessaging().onMessage,
      manager,
      store,
      loadSettings: async () => getDefaultSettings(),
      saveSettings,
      finalize,
      downloads,
      diagnostics: { list: async () => entries, clear },
    });
    await expect(send('getDiagnostics', undefined)).resolves.toEqual(entries);
    await send('clearDiagnostics', undefined);
    expect(clear).toHaveBeenCalledTimes(1);
  });

  it('runs named debug probes and reports their failures', async () => {
    await expect(send('debugProbe', { name: 'ok' })).resolves.toEqual({ fine: true });
    await expect(send('debugProbe', { name: 'boom' })).resolves.toEqual({
      error: 'probe exploded',
    });
    await expect(send('debugProbe', { name: 'weird' })).resolves.toEqual({ error: 'not an error' });
    await expect(send('debugProbe', { name: 'nope' })).resolves.toEqual({
      error: 'unknown probe: nope',
    });
  });

  it('getOverview combines tabs, recordings and settings', async () => {
    const overview = await send('getOverview', undefined);
    expect(overview.tabs).toEqual([{ tabId: 1, snapshot: { state: 'idle' } }]);
    expect(overview.recordings.map((r) => r.id).sort()).toEqual(['failed', 'interrupted', 'saved']);
    expect(overview.settings).toEqual(getDefaultSettings());
  });

  it('forwards commands to the manager', async () => {
    await send('sendCommand', { tabId: 1, command: 'pause' });
    expect(manager.sendCommand).toHaveBeenCalledWith(1, 'pause');
  });

  it('deletes recordings', async () => {
    await send('deleteRecording', { id: 'saved' });
    expect(await store.getRecording('saved')).toBeUndefined();
  });

  it('retries finalization with the recovered flag derived from the status', async () => {
    await send('retryFinalize', { id: 'interrupted' });
    await send('retryFinalize', { id: 'failed' });
    await send('retryFinalize', { id: 'missing' });
    expect(finalize.mock.calls).toEqual([
      ['interrupted', { recovered: true }],
      ['failed', { recovered: false }],
      ['missing', { recovered: false }],
    ]);
  });

  it('shows the saved file of a recording in its folder', async () => {
    await send('showDownload', { id: 'saved' });
    expect(downloads.show).toHaveBeenCalledWith(42);
  });

  it('says so when a recording has no saved file to show, instead of doing nothing', async () => {
    await expect(send('showDownload', { id: 'failed' })).rejects.toThrow(
      'this recording has no saved file',
    );
    await expect(send('showDownload', { id: 'missing' })).rejects.toThrow(
      'this recording has no saved file',
    );
    expect(downloads.show).not.toHaveBeenCalled();
  });

  it('passes on what the browser says when it cannot show the file', async () => {
    downloads.show.mockRejectedValueOnce(new Error('Invalid download id 42'));
    await expect(send('showDownload', { id: 'saved' })).rejects.toThrow('Invalid download id 42');
  });

  it('updates settings', async () => {
    await expect(send('updateSettings', { autoRecord: false })).resolves.toEqual(
      getDefaultSettings(),
    );
    expect(saveSettings).toHaveBeenCalledWith({ autoRecord: false });
  });
});
