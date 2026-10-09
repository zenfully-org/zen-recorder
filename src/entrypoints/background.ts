/** MV3 event page: wires the browser APIs into the (tested) background functions. */

// Before any other import: zod must be in its interpreted mode before a schema is built.
import '@/wiring/configure-zod';
import { browser, defineBackground } from '#imports';
import { checkStorageHeadroom } from '@/lib/background/check-storage-headroom';
import { createDiagnosticsLog } from '@/lib/background/create-diagnostics-log';
import { createRecordingManager } from '@/lib/background/create-recording-manager';
import { createTabPortFaults } from '@/lib/background/create-tab-port-faults';
import { deleteStrayChunks } from '@/lib/background/delete-stray-chunks';
import { finalizeRecording } from '@/lib/background/finalize-recording';
import { recoverOrphans } from '@/lib/background/recover-orphans';
import { registerBackgroundHandlers } from '@/lib/background/register-background-handlers';
import type { ShowSavedFileDeps } from '@/lib/background/show-saved-file';
import { toggleActiveTab } from '@/lib/background/toggle-active-tab';
import { updateBadge } from '@/lib/background/update-badge';
import { watchClosedTabs } from '@/lib/background/watch-closed-tabs';
import { createNameRefusal } from '@/lib/finalize/create-name-refusal';
import { createOpfsScratchFile } from '@/lib/finalize/create-opfs-scratch-file';
import { createSaveFailure } from '@/lib/finalize/create-save-failure';
import { createSaveHold } from '@/lib/finalize/create-save-hold';
import { createSaveQueue, type SaveBlob } from '@/lib/finalize/create-save-queue';
import { pickFinalizeStrategy } from '@/lib/finalize/pick-finalize-strategy';
import { saveBlobToDownloads } from '@/lib/finalize/save-blob-to-downloads';
import { TAB_PORT_NAME } from '@/lib/messaging/create-background-port';
import { getExtensionMessaging } from '@/lib/messaging/get-extension-messaging';
import { createSettingsProbes } from '@/lib/settings/create-settings-probes';
import { getSettingsItem } from '@/lib/settings/get-settings-item';
import { loadSettings } from '@/lib/settings/load-settings';
import { parseSettings } from '@/lib/settings/parse-settings';
import { saveSettings } from '@/lib/settings/save-settings';
import { createFaultInjectingStore } from '@/lib/storage/create-fault-injecting-store';
import { type ChunkStore, openChunkStore } from '@/lib/storage/open-chunk-store';
import { putStrayChunks } from '@/lib/storage/put-stray-chunks';
import { createPopupProbes } from '@/wiring/create-popup-probes';

const RECOVERY_ALARM = 'zen-recorder:recovery';
/** Warn when less than this is free before a video recording (≈2.5 h at 2.5 Mbps). */
const VIDEO_HEADROOM_BYTES = 3 * 1024 ** 3;

const opfsAvailable = (): boolean =>
  typeof navigator.storage?.getDirectory === 'function' &&
  typeof FileSystemWritableFileStream !== 'undefined';

const openScratch = (name: string) =>
  createOpfsScratchFile({ storage: navigator.storage, name: `zen-recorder-${name}.webm` });

/** A test-build probe that arms a fault for the e2e run and says so. */
const armProbe = (arm: () => void) => async () => {
  arm();
  return { armed: true };
};

/** One of the extension's pages: `extension.getViews` is typed as returning empty objects. */
const isPageWindow = (view: unknown): view is Window =>
  typeof view === 'object' && view !== null && 'document' in view && 'location' in view;

/**
 * Test builds: takes the newest recording's download out of the browser's download list, as
 * clearing the list in the Library does. The file stays on disk.
 */
async function forgetNewestDownload(store: ChunkStore): Promise<unknown> {
  const [newest] = await store.listRecordings();
  if (newest?.filename === undefined) return { error: 'the newest recording has no saved file' };
  const erased = await browser.downloads.erase({ filename: newest.filename });
  return { erased: erased.length, filename: newest.filename };
}

/**
 * Test builds: what Show file asked the file manager to show, in order. A test build opens no file
 * manager on the test machine; it notes the file, or the download folder, instead, and refuses an
 * id the browser does not list as `downloads.show` does.
 */
function createFileManagerLog() {
  const revealed: string[] = [];
  return {
    revealed,
    show: async (id: number) => {
      const [item] = await browser.downloads.search({ id });
      if (!item) throw new Error(`Invalid download id ${id}`);
      revealed.push(item.filename);
    },
    showDefaultFolder: () => {
      revealed.push('(the download folder)');
    },
  };
}

/** Test builds: a small file saved through the downloads API, as the person downloads anything. */
async function saveOtherDownload(): Promise<unknown> {
  const url = URL.createObjectURL(new Blob(['not a recording'], { type: 'text/plain' }));
  try {
    const id = await browser.downloads.download({
      url,
      filename: 'zen-recorder-e2e-other.txt',
      conflictAction: 'uniquify',
      saveAs: false,
    });
    for (let attempt = 0; attempt < 40; attempt++) {
      const [item] = await browser.downloads.search({ id });
      if (item?.state === 'complete') return { id, filename: item.filename };
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    return { error: `download ${id} did not complete` };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * The downloads calls behind Show file. A test build notes what Show file reveals instead of opening
 * a file manager on the test machine, and gets probes that read and change the download list.
 */
function wireShowFile(
  testBuild: boolean,
  store: ChunkStore,
): { downloads: ShowSavedFileDeps; probes: Record<string, () => Promise<unknown>> } {
  const log = testBuild ? createFileManagerLog() : null;
  const fileManager = log ?? browser.downloads;
  const downloads: ShowSavedFileDeps = {
    search: (query) => browser.downloads.search(query),
    show: async (id) => {
      await fileManager.show(id);
    },
    showDefaultFolder: () => fileManager.showDefaultFolder(),
  };
  if (!log) return { downloads, probes: {} };
  return {
    downloads,
    probes: {
      'downloads:forget-newest': () => forgetNewestDownload(store),
      // Firefox's download list as the extension sees it in this browser session.
      'downloads:list': async () => ({
        downloads: (await browser.downloads.search({})).map((item) => ({
          id: item.id,
          filename: item.filename,
          state: item.state,
        })),
      }),
      'downloads:save-other': saveOtherDownload,
      'downloads:revealed': async () => ({ revealed: log.revealed }),
    },
  };
}

/**
 * Test builds: the save the e2e run can hold for as long as it needs (a long video's finalize
 * takes its time), make fail once (a download Firefox interrupts), or have Firefox refuse the next
 * file name of (the fallback name), with the probes that arm each.
 */
function createTestSaves(save: SaveBlob) {
  const hold = createSaveHold(save);
  const failure = createSaveFailure(hold.save);
  const refusal = createNameRefusal(failure.save);
  return {
    save: refusal.save,
    probes: {
      'save:hold-next': armProbe(hold.holdNextSave),
      'save:release': async () => {
        hold.release();
        return { released: true };
      },
      'save:fail-next': armProbe(failure.failNextSave),
      'save:refuse-next-name': armProbe(refusal.refuseNextName),
    },
  };
}

/** What the test probe `background:state` says of the newest recordings. */
async function probeRecordings(store: ChunkStore) {
  const recordings = (await store.listRecordings()).slice(0, 8);
  return Promise.all(
    recordings.map(async (r) => ({
      id: r.id,
      status: r.status,
      chunkCount: r.chunkCount,
      // The chunks still in the store: none once the recording is saved.
      storedChunks: await store.countChunks(r.id),
      byteSize: r.byteSize,
      startedAt: r.startedAt,
      error: r.error,
      recovered: r.recovered,
      filename: r.filename,
    })),
  );
}

export default defineBackground({
  type: 'module',
  main() {
    // Test builds let the e2e run make a store call fail, as a full disk would: one chunk, one
    // recording's start, or marking a recording interrupted.
    const faults =
      import.meta.env['WXT_E2E'] === '1' ? createFaultInjectingStore(openChunkStore()) : null;
    const store = faults?.store ?? openChunkStore();
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
    const testSaves = import.meta.env['WXT_E2E'] === '1' ? createTestSaves(queuedSave) : null;
    const save = testSaves?.save ?? queuedSave;

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

    // Test builds let the e2e run drop every tab's Port from this side, and keep it dropped.
    const portFaults = faults ? createTabPortFaults() : null;
    browser.runtime.onConnect.addListener((port) => {
      if (port.name !== TAB_PORT_NAME || portFaults?.admit(port) === false) return;
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
      // Neither rejects: each logs what it could not do and goes on.
      void recoverOrphans({ store, claimedIds, finalize, warn }).then(() =>
        deleteStrayChunks({ store, claimedIds, warn }),
      );
    });
    void browser.alarms.create(RECOVERY_ALARM, { delayInMinutes: 0.5 });

    const showFile = wireShowFile(faults !== null, store);
    registerBackgroundHandlers({
      onMessage: getExtensionMessaging().onMessage,
      manager,
      store,
      loadSettings,
      saveSettings,
      finalize,
      downloads: showFile.downloads,
      diagnostics,
      probes: {
        'background:state': async () => ({
          tabs: manager.tabs(),
          recordings: await probeRecordings(store),
        }),
        // What the popup's Diagnostics button copies, for a test browser: it cannot open the popup.
        diagnostics: () => diagnostics.list(),
        // The lines of the Options page footer. The test browser may not navigate to the
        // extension's own pages, so the background opens the page, reads it and closes it.
        'options:footer': async () => {
          await browser.runtime.openOptionsPage();
          for (let attempt = 0; attempt < 40; attempt++) {
            const view = browser.extension
              .getViews({ type: 'tab' })
              .filter(isPageWindow)
              .find(
                (candidate) =>
                  candidate.location.pathname.endsWith('/options.html') &&
                  candidate.document.querySelector('main h1') !== null,
              );
            if (view) {
              const footer = view.document.querySelector('footer');
              const lines = footer
                ? Array.from(footer.children, (line) => line.textContent ?? '')
                : null;
              view.close();
              return { footer: lines };
            }
            await new Promise((resolve) => setTimeout(resolve, 250));
          }
          return { error: 'the Options page did not open' };
        },
        ...createSettingsProbes(saveSettings),
        ...(faults
          ? {
              'store:fail-next-chunk': armProbe(faults.failNextPutChunk),
              // A disk that stays full: every chunk fails until the store is restored.
              'store:fail-chunks': armProbe(faults.failPutChunks),
              'store:restore-chunks': async () => ({ failed: faults.restorePutChunks() }),
              'store:fail-next-recording': armProbe(faults.failNextPutRecording),
              'store:fail-next-interruption': armProbe(faults.failNextInterruption),
              // A busy store: the next chunk is stored only once released, so a tab can die while
              // a chunk it delivered is still being stored.
              'store:hold-next-chunk': armProbe(faults.holdNextPutChunk),
              'store:held-chunks': async () => ({ held: faults.heldPutChunks() }),
              'store:release-chunks': async () => ({ released: faults.releasePutChunks() }),
              // Chunks of two recordings that were never stored, as a lost announcement leaves
              // them: the newest of one arrived 25 h ago, the other's just now.
              'store:put-stray-chunks': () => putStrayChunks(store),
              'tabs:close-looks-like-a-crash': (sender) =>
                closedTabs.lookLikeACrash(sender.tab?.id),
              'store:recordings-with-chunks': async () => ({
                ids: await store.listRecordingIdsWithChunks(),
              }),
              ...createPopupProbes(manager),
            }
          : {}),
        ...portFaults?.probes,
        ...testSaves?.probes,
        ...showFile.probes,
        // Verifies that streaming remuxes can use OPFS from this (moz-extension) page.
        opfs: async () => {
          if (!opfsAvailable()) return { available: false };
          const scratch = await openScratch('probe');
          const writer = scratch.writable.getWriter();
          await writer.write({ type: 'write', data: new Uint8Array([1, 2, 3, 4]), position: 0 });
          await writer.write({ type: 'write', data: new Uint8Array([9]), position: 1 });
          writer.releaseLock();
          const file = await scratch.file();
          const bytes = Array.from(new Uint8Array(await file.arrayBuffer()));
          await scratch.discard();
          return { available: true, bytes, estimate: await navigator.storage.estimate() };
        },
      },
    });

    getSettingsItem().watch((settings) => manager.broadcastSettings(parseSettings(settings)));
    browser.runtime.onInstalled.addListener(() => {
      void navigator.storage?.persist?.().catch(() => undefined);
    });
    note('info', `background started (${browser.runtime.getManifest().version})`);
    console.info('[zen-recorder] background ready');
  },
});
