import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from '#imports';
import type { RecordingManager } from '@/lib/background/create-recording-manager';
import { saveBlobToDownloads } from '@/lib/finalize/save-blob-to-downloads';
import { getExtensionMessaging } from '@/lib/messaging/get-extension-messaging';
import { getDefaultSettings } from '@/lib/settings/get-default-settings';
import { type ChunkStore, openChunkStore } from '@/lib/storage/open-chunk-store';
import type { RecordingMeta } from '@/lib/types';
import { createFakeDownloads, type FakeDownloads } from '@/test/fakes/create-fake-downloads';
import { registerBackgroundHandlers } from './register-background-handlers';

let counter = 0;
let store: ChunkStore;
let downloads: FakeDownloads;
const NOW = 10_000_000;

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

const manager = {
  tabs: vi.fn(() => [{ tabId: 1, snapshot: { state: 'idle' } }]),
  sendCommand: vi.fn(),
  claimedRecordingIds: vi.fn(() => ['claimed']),
} as unknown as RecordingManager;
const finalize = vi.fn(async () => undefined);
const saveSettings = vi.fn(async () => getDefaultSettings());

/** A fresh store with one recording of each kind the tests need, and the handlers on it. */
async function setUp(): Promise<void> {
  fakeBrowser.reset();
  vi.clearAllMocks();
  store = openChunkStore(`handlers-${++counter}`);
  downloads = createFakeDownloads({ dir: '/dl' });
  await store.putRecording(meta('saved'));
  await store.putRecording(meta('interrupted', { status: 'interrupted' }));
  await store.putRecording(meta('failed', { status: 'failed' }));
  await store.putRecording(meta('failed-recovered', { status: 'failed', recovered: true }));
  // Its tab is gone and nothing ended it; the others may still be delivered by their page.
  const recording = { status: 'recording', lastChunkAt: NOW - 60_000 } as const;
  await store.putRecording(meta('abandoned', recording));
  await store.putRecording(meta('claimed', { ...recording, lastChunkAt: NOW - 3_600_000 }));
  await store.putRecording(meta('live', { ...recording, lastChunkAt: NOW - 1000 }));
  registerBackgroundHandlers({
    onMessage: getExtensionMessaging().onMessage,
    manager,
    store,
    loadSettings: async () => getDefaultSettings(),
    saveSettings,
    finalize,
    downloads: downloads.showDeps,
    now: () => NOW,
    probes: {
      ok: async () => ({ fine: true }),
      caller: async (sender) => ({ sender }),
      boom: async () => {
        throw new Error('probe exploded');
      },
      weird: async () => {
        throw 'not an error';
      },
    },
  });
}

async function tearDown(): Promise<void> {
  getExtensionMessaging().removeAllListeners();
  await store.close();
}

beforeEach(setUp);
afterEach(tearDown);

const send = getExtensionMessaging().sendMessage;

/** Saves a file through the downloads API, as the background saves a recording. */
const saveFile = (relativePath: string) =>
  saveBlobToDownloads(new Blob(['webm']), relativePath, { ...downloads.deps, pollMs: 5 });

/** A recording saved as `relativePath`, stored as the background stores it. */
async function saveRecording(id: string, relativePath: string): Promise<string> {
  const saved = await saveFile(relativePath);
  // A recording saved by an earlier version also kept the download's id next to its path.
  await store.putRecording(meta(id, { status: 'saved', ...saved }));
  return saved.filename;
}

describe('registerBackgroundHandlers', () => {
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
      downloads: downloads.showDeps,
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

  it('tells a debug probe who asked: a probe about a tab acts on the one that called it', async () => {
    // The test browser's messages carry an empty sender; a meeting tab's carries the tab.
    await expect(send('debugProbe', { name: 'caller' })).resolves.toEqual({ sender: {} });
  });

  it('getOverview combines tabs, recordings and settings', async () => {
    const overview = await send('getOverview', undefined);
    expect(overview.tabs).toEqual([{ tabId: 1, snapshot: { state: 'idle' } }]);
    expect(overview.recordings.map((r) => r.id).sort()).toEqual([
      'abandoned',
      'claimed',
      'failed',
      'failed-recovered',
      'interrupted',
      'live',
      'saved',
    ]);
    expect(overview.settings).toEqual(getDefaultSettings());
  });

  /**
   * A message as any of the extension's pages or content scripts can post it, in the messaging
   * library's own format: the typed `sendMessage` admits no malformed data.
   */
  const sendRaw = (type: string, data: unknown): Promise<unknown> =>
    fakeBrowser.runtime.sendMessage({ id: 1, type, data, timestamp: Date.now() });

  it.each([
    { type: 'sendCommand', data: { tabId: '1', command: 'explode' } },
    { type: 'deleteRecording', data: { id: 5 } },
    { type: 'retryFinalize', data: {} },
    { type: 'showDownload', data: null },
  ])(
    'refuses a malformed $type before it reaches the manager or the store',
    async ({ type, data }) => {
      expect(await sendRaw(type, data)).toEqual({
        err: expect.objectContaining({ message: 'the request is malformed' }),
      });
      expect(manager.sendCommand).not.toHaveBeenCalled();
      expect(finalize).not.toHaveBeenCalled();
      expect(await store.getRecording('saved')).toBeDefined();
    },
  );

  it('answers a malformed probe request as it answers an unknown probe', async () => {
    expect(await sendRaw('debugProbe', { name: 7 })).toEqual({
      res: { error: 'the request is malformed' },
    });
  });

  it('forwards commands to the manager', async () => {
    await send('sendCommand', { tabId: 1, command: 'pause' });
    expect(manager.sendCommand).toHaveBeenCalledWith(1, 'pause');
  });

  it('deletes recordings', async () => {
    await send('deleteRecording', { id: 'saved' });
    expect(await store.getRecording('saved')).toBeUndefined();
  });

  it('shows the saved file of a recording in its folder', async () => {
    const filename = await saveRecording('standup', 'zen-recorder/standup.webm');
    await send('showDownload', { id: 'standup' });
    expect(downloads.revealed).toEqual([filename]);
  });

  it.each([
    { what: 'another download took its id', downloadAfterRestart: true },
    { what: 'no download has its id', downloadAfterRestart: false },
  ])(
    'after a browser restart, reveals no other download and says why it cannot show the file ($what)',
    async ({ downloadAfterRestart }) => {
      const filename = await saveRecording('standup', 'zen-recorder/standup.webm');
      downloads.restart();
      // The next session numbers its downloads from 1 again, the id the recording was saved under.
      if (downloadAfterRestart) await saveFile('invoice.pdf');
      const outcome = await send('showDownload', { id: 'standup' }).then(
        () => 'shown',
        (error: unknown) => (error instanceof Error ? error.message : String(error)),
      );
      expect({ revealed: downloads.revealed, outcome }).toEqual({
        revealed: ['/dl'],
        outcome:
          'Firefox no longer lists it among its downloads (it forgets them when it restarts or ' +
          'when the list is cleared), so the download folder opened instead. It was saved as ' +
          filename,
      });
    },
  );

  it('says so when a recording has no saved file to show, instead of doing nothing', async () => {
    await expect(send('showDownload', { id: 'failed' })).rejects.toThrow(
      'this recording has no saved file',
    );
    await expect(send('showDownload', { id: 'missing' })).rejects.toThrow(
      'this recording has no saved file',
    );
    expect(downloads.revealed).toEqual([]);
  });

  it('passes on what the browser says when it cannot show the file', async () => {
    await saveRecording('standup', 'zen-recorder/standup.webm');
    vi.spyOn(downloads.showDeps, 'show').mockRejectedValueOnce(new Error('no file manager'));
    await expect(send('showDownload', { id: 'standup' })).rejects.toThrow('no file manager');
  });

  it('updates settings', async () => {
    await expect(send('updateSettings', { autoRecord: false })).resolves.toEqual(
      getDefaultSettings(),
    );
    expect(saveSettings).toHaveBeenCalledWith({ autoRecord: false });
  });
});

describe('registerBackgroundHandlers: Retry save', () => {
  it('retries a save as recovered when the recording says its tab was lost, or is still interrupted from before it did', async () => {
    for (const id of ['interrupted', 'failed', 'failed-recovered', 'missing']) {
      await send('retryFinalize', { id });
    }
    expect(finalize.mock.calls).toEqual([
      ['interrupted', { recovered: true }],
      ['failed', { recovered: false }],
      ['failed-recovered', { recovered: true }],
      ['missing', { recovered: false }],
    ]);
  });

  it('saves a recording that no tab claims and that got no chunk for a minute, interrupted and recovered', async () => {
    await send('retryFinalize', { id: 'abandoned' });
    expect(await store.getRecording('abandoned')).toMatchObject({
      status: 'interrupted',
      endedAt: NOW,
    });
    expect(finalize.mock.calls).toEqual([['abandoned', { recovered: true }]]);
  });

  it('judges a recording left recording by the wall clock by default', async () => {
    getExtensionMessaging().removeAllListeners();
    registerBackgroundHandlers({
      onMessage: getExtensionMessaging().onMessage,
      manager,
      store,
      loadSettings: async () => getDefaultSettings(),
      saveSettings,
      finalize,
      downloads: downloads.showDeps,
    });
    // Its last chunk came at NOW, which the wall clock left behind long ago.
    await send('retryFinalize', { id: 'live' });
    expect(finalize.mock.calls).toEqual([['live', { recovered: true }]]);
  });

  it('refuses to save a recording its page may still deliver', async () => {
    for (const id of ['claimed', 'live']) {
      await expect(send('retryFinalize', { id })).rejects.toThrow(
        'its meeting tab may still deliver it',
      );
      expect(await store.getRecording(id)).toMatchObject({ status: 'recording' });
    }
    expect(finalize).not.toHaveBeenCalled();
  });
});
