/**
 * Test builds only (`pnpm build:e2e`): the faults the end-to-end run injects into the background
 * and the probes it reads the background through. The background calls it behind
 * `import.meta.env.WXT_E2E === '1'`, a constant the bundler replaces, so a release build leaves it
 * out with everything it imports (`scripts/release/list-test-build-modules.ts` names them, and a
 * release build fails when it bundles one).
 */
import type { Browser } from 'wxt/browser';
import { browser } from '#imports';
import type { DiagnosticsLog } from '@/lib/background/create-diagnostics-log';
import type { RecordingManager } from '@/lib/background/create-recording-manager';
import { createTabPortFaults } from '@/lib/background/create-tab-port-faults';
import type { ShowSavedFileDeps } from '@/lib/background/show-saved-file';
import type { ClosedTabs } from '@/lib/background/watch-closed-tabs';
import { createNameRefusal } from '@/lib/finalize/create-name-refusal';
import type { OpfsScratchFile } from '@/lib/finalize/create-opfs-scratch-file';
import { createSaveFailure } from '@/lib/finalize/create-save-failure';
import { createSaveHold } from '@/lib/finalize/create-save-hold';
import type { SaveBlob } from '@/lib/finalize/create-save-queue';
import { createSettingsProbes } from '@/lib/settings/create-settings-probes';
import { saveSettings } from '@/lib/settings/save-settings';
import {
  createFaultInjectingStore,
  type FaultInjectingStore,
} from '@/lib/storage/create-fault-injecting-store';
import type { ChunkStore } from '@/lib/storage/open-chunk-store';
import type { EventStore } from '@/lib/storage/open-event-store';
import { createPopupProbes } from '@/wiring/create-popup-probes';

type Probes = Record<string, (sender: Browser.runtime.MessageSender) => Promise<unknown>>;

/** What the probes read, once the background is wired. */
interface BackgroundProbeDeps {
  manager: RecordingManager;
  store: ChunkStore;
  diagnostics: DiagnosticsLog;
  opfsAvailable: () => boolean;
  openScratch: (name: string) => Promise<OpfsScratchFile>;
  /** Makes a tab's close look like a crash: the e2e run cannot crash a tab. */
  closedTabs: ClosedTabs;
  /** The meeting events, for the run to read what a recording's notes will be built from. */
  events: EventStore;
}

export interface BackgroundTestBuild {
  /** The chunk store, with the faults the run injects: a full disk, a busy store. */
  store: ChunkStore;
  /** The save, which the run can hold, make fail once, or have the next file name refused. */
  save: SaveBlob;
  /** False for a tab's Port the run keeps dropped, as an event page that restarted does. */
  admit: (port: Browser.runtime.Port) => boolean;
  /** Notes what Show file reveals, instead of opening a file manager on the test machine. */
  fileManager: Pick<ShowSavedFileDeps, 'show' | 'showDefaultFolder'>;
  probes: (deps: BackgroundProbeDeps) => Probes;
}

/** A probe that arms a fault for the run and says so. */
const armProbe = (arm: () => void) => async () => {
  arm();
  return { armed: true };
};

/** One of the extension's pages: `extension.getViews` is typed as returning empty objects. */
const isPageWindow = (view: unknown): view is Window =>
  typeof view === 'object' && view !== null && 'document' in view && 'location' in view;

/** Takes the newest recording's download out of the list, as clearing it in the Library does. */
async function forgetNewestDownload(store: ChunkStore): Promise<unknown> {
  const [newest] = await store.listRecordings();
  if (newest?.filename === undefined) return { error: 'the newest recording has no saved file' };
  const erased = await browser.downloads.erase({ filename: newest.filename });
  return { erased: erased.length, filename: newest.filename };
}

/**
 * What Show file asked the file manager to show, in order: the file, or the download folder. It
 * refuses an id the browser does not list, as `downloads.show` does.
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

/** A small file saved through the downloads API, as the person downloads anything. */
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

/** The lines of the Options page's footer: the background opens the page, reads it, closes it. */
async function readOptionsFooter(): Promise<unknown> {
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
      const lines = footer ? Array.from(footer.children, (line) => line.textContent ?? '') : null;
      view.close();
      return { footer: lines };
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return { error: 'the Options page did not open' };
}

/** Whether a streaming remux can use OPFS from the background's (moz-extension) page. */
async function probeOpfs({ opfsAvailable, openScratch }: BackgroundProbeDeps): Promise<unknown> {
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
}

/** The tabs, and the newest recordings as the store holds them. */
async function readBackgroundState({ manager, store }: BackgroundProbeDeps): Promise<unknown> {
  return {
    tabs: manager.tabs(),
    recordings: await Promise.all(
      (await store.listRecordings()).slice(0, 8).map(async (r) => ({
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
    ),
  };
}

/** Two recordings' chunks that were never announced: one 25 h old, one just now. */
async function putStrayChunks(store: ChunkStore): Promise<unknown> {
  const stale = `stray-${crypto.randomUUID()}`;
  const recent = `stray-${crypto.randomUUID()}`;
  const receivedAt = Date.now();
  for (const [recordingId, age] of [
    [stale, 25 * 60 * 60 * 1000],
    [recent, 0],
  ] as const) {
    for (const seq of [0, 1]) {
      const blob = new Blob([new Uint8Array(1024)]);
      await store.putChunk({
        recordingId,
        seq,
        blob,
        byteLength: blob.size,
        receivedAt: receivedAt - age,
      });
    }
  }
  return { stale, recent };
}

/** The store's faults: a chunk, a start or an interruption that fails, and a busy store. */
function storeProbes(faults: FaultInjectingStore): Probes {
  return {
    'store:fail-next-chunk': armProbe(faults.failNextPutChunk),
    // A disk that stays full: every chunk fails until the store is restored.
    'store:fail-chunks': armProbe(faults.failPutChunks),
    'store:restore-chunks': async () => ({ failed: faults.restorePutChunks() }),
    'store:fail-next-recording': armProbe(faults.failNextPutRecording),
    'store:fail-next-interruption': armProbe(faults.failNextInterruption),
    // A busy store: the next chunk is stored only once released, so a tab can die while a chunk
    // it delivered is still being stored.
    'store:hold-next-chunk': armProbe(faults.holdNextPutChunk),
    'store:held-chunks': async () => ({ held: faults.heldPutChunks() }),
    'store:release-chunks': async () => ({ released: faults.releasePutChunks() }),
    'store:put-stray-chunks': () => putStrayChunks(faults.store),
    'store:recordings-with-chunks': async () => ({
      ids: await faults.store.listRecordingIdsWithChunks(),
    }),
  };
}

/** The newest recording's end and the meeting events stored for it. */
async function readNewestEvents(store: ChunkStore, events: EventStore): Promise<unknown> {
  const [newest] = await store.listRecordings();
  if (!newest) return { error: 'no recording is stored' };
  const stored = await events.getEvents(newest.id);
  return {
    recording: {
      id: newest.id,
      status: newest.status,
      endReason: newest.endReason ?? null,
      eventsProtocol: newest.eventsProtocol ?? null,
      eventCount: newest.eventCount ?? null,
      eventsDropped: newest.eventsDropped ?? null,
      eventsUnsent: newest.eventsUnsent ?? null,
    },
    events: stored.map(({ event, receivedAt }) => ({ ...event, receivedAt })),
  };
}

/** The download list as the extension sees it, and what Show file revealed. */
function downloadProbes(store: ChunkStore, revealed: readonly string[]): Probes {
  return {
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
    'downloads:revealed': async () => ({ revealed }),
  };
}

export function createBackgroundTestBuild(base: ChunkStore, save: SaveBlob): BackgroundTestBuild {
  const faults = createFaultInjectingStore(base);
  const hold = createSaveHold(save);
  const failure = createSaveFailure(hold.save);
  const refusal = createNameRefusal(failure.save);
  const ports = createTabPortFaults();
  const fileManager = createFileManagerLog();
  return {
    store: faults.store,
    save: refusal.save,
    admit: (port) => ports.admit(port),
    fileManager,
    probes: (deps) => ({
      'background:state': () => readBackgroundState(deps),
      // What the popup's Diagnostics button copies: the test browser cannot open the popup.
      diagnostics: () => deps.diagnostics.list(),
      'options:footer': readOptionsFooter,
      opfs: () => probeOpfs(deps),
      ...createSettingsProbes(saveSettings),
      ...storeProbes(faults),
      'notes:events': () => readNewestEvents(deps.store, deps.events),
      'tabs:close-looks-like-a-crash': (sender) => deps.closedTabs.lookLikeACrash(sender.tab?.id),
      ...createPopupProbes(deps.manager),
      ...ports.probes,
      'save:hold-next': armProbe(hold.holdNextSave),
      'save:release': async () => {
        hold.release();
        return { released: true };
      },
      'save:fail-next': armProbe(failure.failNextSave),
      'save:refuse-next-name': armProbe(refusal.refuseNextName),
      ...downloadProbes(deps.store, fileManager.revealed),
    }),
  };
}
