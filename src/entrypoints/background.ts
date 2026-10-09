/** MV3 event page: wires the browser APIs into the (tested) background functions. */

// Before any other import: zod must be in its interpreted mode before a schema is built.
import '@/wiring/configure-zod';
import { browser, defineBackground } from '#imports';
import { checkStorageHeadroom } from '@/lib/background/check-storage-headroom';
import { createDiagnosticsLog } from '@/lib/background/create-diagnostics-log';
import { createRecordingManager } from '@/lib/background/create-recording-manager';
import { deleteStrayChunks } from '@/lib/background/delete-stray-chunks';
import { deleteStrayEvents } from '@/lib/background/delete-stray-events';
import { finalizeRecording } from '@/lib/background/finalize-recording';
import { recoverOrphans } from '@/lib/background/recover-orphans';
import { registerBackgroundHandlers } from '@/lib/background/register-background-handlers';
import { toggleActiveTab } from '@/lib/background/toggle-active-tab';
import { updateBadge } from '@/lib/background/update-badge';
import { watchClosedTabs } from '@/lib/background/watch-closed-tabs';
import { createOpfsScratchFile } from '@/lib/finalize/create-opfs-scratch-file';
import { createSaveQueue } from '@/lib/finalize/create-save-queue';
import { pickFinalizeStrategy } from '@/lib/finalize/pick-finalize-strategy';
import { saveBlobToDownloads } from '@/lib/finalize/save-blob-to-downloads';
import { TAB_PORT_NAME } from '@/lib/messaging/create-background-port';
import { getExtensionMessaging } from '@/lib/messaging/get-extension-messaging';
import { getSettingsItem } from '@/lib/settings/get-settings-item';
import { loadSettings } from '@/lib/settings/load-settings';
import { parseSettings } from '@/lib/settings/parse-settings';
import { saveSettings } from '@/lib/settings/save-settings';
import { openChunkStore } from '@/lib/storage/open-chunk-store';
import { openEventStore } from '@/lib/storage/open-event-store';
import { createBackgroundTestBuild } from '@/wiring/create-background-test-build';

const RECOVERY_ALARM = 'zen-recorder:recovery';
/** Warn when less than this is free before a video recording (≈2.5 h at 2.5 Mbps). */
const VIDEO_HEADROOM_BYTES = 3 * 1024 ** 3;

const opfsAvailable = (): boolean =>
  typeof navigator.storage?.getDirectory === 'function' &&
  typeof FileSystemWritableFileStream !== 'undefined';

const openScratch = (name: string) =>
  createOpfsScratchFile({ storage: navigator.storage, name: `zen-recorder-${name}.webm` });

/** The scratch-file helpers, for the test build's OPFS probe. */
const scratch = { opfsAvailable, openScratch };

/**
 * The recovery pass: saves the recordings no tab claims any more, then deletes the chunks and the
 * meeting events no recording was stored for. None rejects: each logs what it could not do and
 * goes on.
 */
const runRecoveryPass = (
  deps: Parameters<typeof recoverOrphans>[0] & Parameters<typeof deleteStrayEvents>[0],
): Promise<unknown> =>
  recoverOrphans(deps)
    .then(() => deleteStrayChunks(deps))
    .then(() => deleteStrayEvents(deps));

export default defineBackground({
  type: 'module',
  main() {
    const diagnostics = createDiagnosticsLog({
      load: async () => (await browser.storage.local.get('diagnostics'))['diagnostics'],
      save: (entries) => browser.storage.local.set({ diagnostics: entries }),
    });
    const note = (level: 'info' | 'warn' | 'error', message: string) =>
      diagnostics.append({ level, source: 'background', message });
    const warn = (message: string, detail?: unknown) => {
      console.warn(`[zen-recorder] ${message}`, detail ?? '');
      note('warn', detail === undefined ? message : `${message} ${String(detail)}`);
    };

    // Every file is saved through this one queue: two downloads of the same new name at the same
    // moment can both be lost.
    const queuedSave = createSaveQueue((blob, path) =>
      saveBlobToDownloads(blob, path, {
        download: (options) => browser.downloads.download(options),
        search: (query) => browser.downloads.search(query),
        createObjectURL: (b) => URL.createObjectURL(b),
        revokeObjectURL: (url) => URL.revokeObjectURL(url),
        setTimeout: (handler, ms) => self.setTimeout(handler, ms),
      }),
    );
    // A test build (`pnpm build:e2e`) lets the end-to-end run inject faults and read the background
    // through probes. The bundler replaces the condition with a constant, so a release build has
    // none of it.
    const testBuild =
      import.meta.env.WXT_E2E === '1'
        ? createBackgroundTestBuild(openChunkStore(), queuedSave)
        : null;
    const store = testBuild?.store ?? openChunkStore();
    const events = openEventStore();
    const save = testBuild?.save ?? queuedSave;

    const finalize = finalizeRecording({
      store,
      loadSettings,
      // Mediabunny is ~500 kB; load it only when a recording is actually being finalized.
      remux: async (blob, mimeType) => {
        const strategy = pickFinalizeStrategy({
          byteSize: blob.size,
          opfsAvailable: opfsAvailable(),
        });
        const { remuxWebm } = await import('@/lib/finalize/remux-webm');
        return remuxWebm(blob, mimeType, {
          strategy,
          openScratch: () => openScratch(crypto.randomUUID()),
        });
      },
      save,
      onSaved: (info) => {
        note('info', `saved ${info.filename} (${info.chunkCount} chunks, ${info.byteSize} bytes)`);
        manager.notifyRecording(info.recordingId, { type: 'saved', ...info });
        void browser.notifications
          .create({
            type: 'basic',
            iconUrl: browser.runtime.getURL('/icons/128.png'),
            title: info.recovered ? 'Meeting recording recovered' : 'Meeting recording saved',
            message: info.filename,
          })
          .catch(() => undefined);
      },
      onFailed: (recordingId, message) => {
        note('error', `finalize ${recordingId} failed: ${message}`);
        manager.notifyRecording(recordingId, { type: 'error', recordingId, message });
      },
      warn,
    });

    const manager = createRecordingManager({
      store,
      events,
      loadSettings,
      finalize,
      onSnapshotsChanged: (snapshots) => void updateBadge(snapshots, browser.action, warn),
      onLog: (log, tabId) => diagnostics.append({ ...log, source: `page:${tabId}` }),
      onRecordingStarted: (info) => {
        note(
          'info',
          `recording ${info.recordingId} started: ${info.title} (${info.mimeType}${info.hasVideo ? ', video' : ''})`,
        );
        if (!info.hasVideo) return;
        void checkStorageHeadroom({
          estimate: () => navigator.storage.estimate(),
          needBytes: VIDEO_HEADROOM_BYTES,
        }).then(({ ok, freeBytes }) => {
          if (ok || freeBytes === null) return;
          const gb = (freeBytes / 1024 ** 3).toFixed(1);
          manager.notifyRecording(info.recordingId, {
            type: 'error',
            recordingId: info.recordingId,
            message: `only ${gb} GB of browser storage is free; a long video recording may fail`,
          });
        });
      },
      setTimeout: (handler, ms) => setTimeout(handler, ms),
      warn,
    });

    browser.runtime.onConnect.addListener((port) => {
      if (port.name !== TAB_PORT_NAME || testBuild?.admit(port) === false) return;
      manager.handlePort(port);
    });
    // A closed tab's own end can be lost on the way: the browser's word ends its recording.
    const closedTabs = watchClosedTabs(browser.tabs.onRemoved, (id) => manager.tabClosed(id));
    browser.commands.onCommand.addListener((command) => {
      if (command !== 'toggle-recording') return;
      const queryActiveTab = () => browser.tabs.query({ active: true, currentWindow: true });
      void toggleActiveTab({ queryActiveTab, toggle: (tabId) => manager.toggle(tabId), warn });
    });
    browser.alarms.onAlarm.addListener((alarm) => {
      if (alarm.name !== RECOVERY_ALARM) return;
      const claimedIds = () => manager.claimedRecordingIds();
      void runRecoveryPass({ store, events, claimedIds, finalize, warn });
    });
    void browser.alarms.create(RECOVERY_ALARM, { delayInMinutes: 0.5 });

    const fileManager = testBuild?.fileManager ?? browser.downloads;
    registerBackgroundHandlers({
      onMessage: getExtensionMessaging().onMessage,
      manager,
      store,
      events,
      loadSettings,
      saveSettings,
      finalize,
      downloads: {
        search: (query) => browser.downloads.search(query),
        show: async (id) => {
          await fileManager.show(id);
        },
        showDefaultFolder: () => fileManager.showDefaultFolder(),
      },
      diagnostics,
      ...(testBuild && {
        probes: testBuild.probes({ manager, store, diagnostics, closedTabs, events, ...scratch }),
      }),
    });

    getSettingsItem().watch((settings) => manager.broadcastSettings(parseSettings(settings)));
    browser.runtime.onInstalled.addListener(() => {
      void navigator.storage?.persist?.().catch(() => undefined);
    });
    note('info', `background started (${browser.runtime.getManifest().version})`);
    console.info('[zen-recorder] background ready');
  },
});
