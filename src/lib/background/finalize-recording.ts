/**
 * Turns the persisted chunks of a recording into a seekable WebM in the Downloads folder:
 * assemble → remux (Mediabunny) → downloads API → cleanup. Failures leave the chunks in place so
 * the user can retry from the popup.
 *
 * A recording no player could open is refused rather than saved: no chunk, no first chunk (the
 * file header), or no audio or video sample in the file. The recording is marked `failed`
 * with the reason, in words and as a code (`refusal`, so a reader can tell it from a failure a
 * retry may fix), and reported through `onFailed`, like any other failure. Every other remux
 * failure still saves the raw file, which plays without seeking.
 *
 * A file name Firefox refuses is saved once more under the dated fallback name. Firefox
 * refuses a name before it creates a download, so nothing of the first try is on disk; a save that
 * fails later (interrupted, timed out) is never tried again under another name, because its file
 * may exist.
 *
 * Each save stores its download's address with the recording before the download starts, until
 * the recording is saved or the attempt failed. A background that stops after Firefox saved the
 * file but before the recording was marked saved (an update, a reload) leaves it `finalizing` with
 * its chunks, and the next recovery pass finalizes it again: its saves take the files Firefox lists
 * under those addresses instead of saving copies. A failed attempt forgets them, so a retry saves
 * the file again: the person may have removed what a failed attempt left.
 */
import { buildDownloadPath } from '@/lib/finalize/build-download-path';
import type { SaveBlob } from '@/lib/finalize/create-save-queue';
import { extensionForMimeType } from '@/lib/finalize/extension-for-mime-type';
import type { RemuxResult } from '@/lib/finalize/remux-webm';
import type { SaveResult } from '@/lib/finalize/save-blob-to-downloads';
import type { ChunkStore } from '@/lib/storage/open-chunk-store';
import type { RecordingMeta, RecordingRefusal, Settings } from '@/lib/types';

/** The name a recording is saved under when Firefox refuses the one its template renders. */
const FALLBACK_TEMPLATE = '{date}_{time}_recording';
/** Why a recording is refused, in the words the popup and Diagnostics show. */
const REFUSALS: Record<RecordingRefusal, string> = {
  'no-chunks': 'no audio data was received',
  'no-header': 'the first chunk (file header) was lost; nothing playable to save',
  'no-samples':
    'nothing was recorded (stopped before the first audio or video sample); no file saved',
};

/**
 * `downloads.download` throws `filename must not …` for a name it refuses, before it creates a
 * download (Gecko's `ext-downloads.js`).
 */
function isNameRefused(error: unknown): error is Error {
  return error instanceof Error && error.message.startsWith('filename must not');
}

export interface FinalizeDeps {
  store: ChunkStore;
  loadSettings: () => Promise<Settings>;
  remux: (blob: Blob, mimeType: string) => Promise<RemuxResult>;
  /** The background's one save queue: two downloads of one new name at once lose it. */
  save: SaveBlob;
  onSaved?: (info: {
    recordingId: string;
    filename: string;
    chunkCount: number;
    byteSize: number;
    recovered: boolean;
  }) => void;
  onFailed?: (recordingId: string, message: string) => void;
  warn?: (message: string) => void;
}

/** Where the save of each file of a recording remembers its download until it settles. */
type DownloadSlot = 'downloadUrl' | 'rawDownloadUrl';
/** What a save that settled stores: no download is left to look for. */
const NO_DOWNLOAD = { downloadUrl: undefined, rawDownloadUrl: undefined } as const;

/** Nothing a player could open: saves no file and keeps the chunks, so a retry says the same. */
async function refuse(
  deps: FinalizeDeps,
  recordingId: string,
  refusal: RecordingRefusal,
): Promise<RecordingMeta | undefined> {
  const error = REFUSALS[refusal];
  deps.onFailed?.(recordingId, error);
  return await deps.store.updateRecording(recordingId, { status: 'failed', error, refusal });
}

/**
 * What a recording's save stores: its file, and the facts its meeting notes are built from, which
 * are due from here on (written next, or by the next background start).
 */
function savedUpdate(
  meta: RecordingMeta,
  files: { saved: SaveResult; rawCopy: SaveResult | undefined },
  remux: RemuxResult,
): Partial<RecordingMeta> {
  const durationMs = remux.durationMs ?? meta.durationMs;
  // `recovered` was stored when this attempt started; the error of one that failed goes.
  return {
    status: 'saved',
    filename: files.saved.filename,
    byteSize: remux.blob.size,
    error: undefined,
    hasVideo: meta.mimeType.startsWith('video/'),
    ...(durationMs !== undefined ? { durationMs } : {}),
    notesState: 'pending',
    startOffsetMs: remux.startOffsetMs,
    remuxed: remux.remuxed,
    ...(files.rawCopy ? { rawFilename: files.rawCopy.filename } : {}),
    ...NO_DOWNLOAD,
  };
}

/**
 * Saves the files of recording `meta` under the names its template renders, with `suffix`, or under
 * the dated fallback once Firefox refused a name: every later file of the recording (its raw copy)
 * takes the fallback too.
 */
function createFileSaver(
  deps: FinalizeDeps,
  meta: RecordingMeta,
  settings: Settings,
  warn: (message: string) => void,
): (blob: Blob, suffix: string | undefined, slot: DownloadSlot) => Promise<SaveResult> {
  let template = settings.filenameTemplate;
  const pathFor = (suffix: string | undefined) =>
    buildDownloadPath({
      template,
      subfolder: settings.downloadSubfolder,
      title: meta.title,
      meetingCode: meta.meetingCode,
      // Recordings stored before providers existed are Google Meet ones.
      provider: meta.provider ?? 'meet',
      startedAt: meta.startedAt,
      extension: extensionForMimeType(meta.mimeType),
      ...(suffix ? { suffix } : {}),
    });
  return async (blob, suffix, slot) => {
    const path = pathFor(suffix);
    const options = {
      // Left by an attempt whose background stopped before it heard how the download ended.
      resumeFrom: meta[slot],
      remember: async (url: string) => {
        const patch = slot === 'downloadUrl' ? { downloadUrl: url } : { rawDownloadUrl: url };
        await deps.store.updateRecording(meta.id, patch);
      },
    };
    try {
      return await deps.save(blob, path, options);
    } catch (error) {
      if (template === FALLBACK_TEMPLATE || !isNameRefused(error)) throw error;
      template = FALLBACK_TEMPLATE;
      const fallback = pathFor(suffix);
      warn(`Firefox refused the file name ${path} (${error.message}); saving it as ${fallback}`);
      return await deps.save(blob, fallback, options);
    }
  };
}

/** Idempotent per recording id: concurrent calls for the same id resolve to `undefined`. */
export function finalizeRecording(
  deps: FinalizeDeps,
): (recordingId: string, options: { recovered: boolean }) => Promise<RecordingMeta | undefined> {
  const inFlight = new Set<string>();
  const warn = deps.warn ?? (() => undefined);

  return async (recordingId, options) => {
    if (inFlight.has(recordingId)) return undefined;
    inFlight.add(recordingId);
    try {
      const meta = await deps.store.getRecording(recordingId);
      if (!meta) return undefined;
      // Stored first: once the save fails the status no longer says whether it was recovered,
      // and a retry or the next recovery pass reads it here.
      await deps.store.updateRecording(recordingId, { ...options, status: 'finalizing' });
      const chunks = await deps.store.getChunks(recordingId);
      if (chunks.length === 0) return await refuse(deps, recordingId, 'no-chunks');
      if (chunks[0]?.seq !== 0) {
        // Without the first chunk there is no container header.
        return await refuse(deps, recordingId, 'no-header');
      }
      const gap = chunks.findIndex((chunk, index) => chunk.seq !== index);
      if (gap !== -1) warn(`recording ${recordingId}: chunk sequence gap at index ${gap}`);

      const raw = new Blob(
        chunks.map((chunk) => chunk.blob),
        { type: meta.mimeType },
      );
      const remux = await deps.remux(raw, meta.mimeType);
      if (remux.empty) return await refuse(deps, recordingId, 'no-samples');
      if (!remux.remuxed) warn(`remux failed, saving raw file: ${remux.error ?? 'unknown'}`);

      const settings = await deps.loadSettings();
      const save = createFileSaver(deps, meta, settings, warn);
      let saved: SaveResult;
      try {
        saved = await save(
          remux.blob,
          options.recovered ? '(recovered)' : undefined,
          'downloadUrl',
        );
      } finally {
        await remux.cleanup?.().catch((error: unknown) => warn(`cleanup failed: ${String(error)}`));
      }
      const rawSuffix = options.recovered ? '(recovered) raw' : 'raw';
      const rawCopy =
        settings.keepRawCopy && remux.remuxed
          ? await save(raw, rawSuffix, 'rawDownloadUrl').catch(
              (error: unknown) => void warn(`raw copy failed: ${String(error)}`),
            )
          : undefined;
      const updated = await deps.store.updateRecording(
        recordingId,
        savedUpdate(meta, { saved, rawCopy }, remux),
      );
      await deps.store.deleteChunks(recordingId);
      deps.onSaved?.({
        recordingId,
        filename: saved.filename,
        chunkCount: chunks.length,
        byteSize: raw.size,
        recovered: options.recovered,
      });
      return updated;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      deps.onFailed?.(recordingId, message);
      // A retry saves the file again: the person may have removed what this attempt saved.
      return await deps.store.updateRecording(recordingId, {
        status: 'failed',
        error: message,
        ...NO_DOWNLOAD,
      });
    } finally {
      inFlight.delete(recordingId);
    }
  };
}
