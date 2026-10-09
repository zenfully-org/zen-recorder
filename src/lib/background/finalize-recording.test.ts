import { afterEach, describe, expect, it, vi } from 'vitest';
import { createNameRefusal } from '@/lib/finalize/create-name-refusal';
import { createSaveQueue } from '@/lib/finalize/create-save-queue';
import { type RemuxResult, remuxWebm } from '@/lib/finalize/remux-webm';
import { saveBlobToDownloads } from '@/lib/finalize/save-blob-to-downloads';
import { getDefaultSettings } from '@/lib/settings/get-default-settings';
import { type ChunkStore, openChunkStore } from '@/lib/storage/open-chunk-store';
import type { RecordingMeta, Settings } from '@/lib/types';
import { buildHeaderOnlyWebm } from '@/test/build-header-only-webm';
import { createFakeDownloads } from '@/test/fakes/create-fake-downloads';
import { type FinalizeDeps, finalizeRecording } from './finalize-recording';

let counter = 0;
let store: ChunkStore;

const meta: RecordingMeta = {
  id: 'rec-1',
  meetingCode: 'abc-defg-hij',
  title: 'Standup',
  startedAt: new Date(2026, 8, 2, 10, 0).getTime(),
  mimeType: 'audio/webm;codecs=opus',
  status: 'ended',
  chunkCount: 2,
  byteSize: 6,
  durationMs: 5000,
};

async function seed(chunks: number[] = [0, 1]): Promise<void> {
  store = openChunkStore(`finalize-${++counter}`);
  await store.putRecording(meta);
  for (const seq of chunks) {
    await store.putChunk({
      recordingId: meta.id,
      seq,
      blob: new Blob([`c${seq}`]),
      byteLength: 2,
      receivedAt: seq,
    });
  }
}

/** A remux that wrote the file, 1 s long, with nothing to move. */
const remuxedTo = (blob: Blob, mimeType: string): RemuxResult => ({
  blob: new Blob([blob], { type: mimeType }),
  durationMs: 1000,
  startOffsetMs: 0,
  remuxed: true,
});

/** A remux that failed: the file is saved as it came. */
const notRemuxed = (blob: Blob, error?: string): RemuxResult => ({
  blob,
  durationMs: null,
  startOffsetMs: 0,
  remuxed: false,
  ...(error === undefined ? {} : { error }),
});

function deps(
  overrides: Partial<FinalizeDeps> = {},
  settings: Partial<Settings> = {},
): FinalizeDeps & {
  saved: { size: number; path: string }[];
  warnings: string[];
} {
  const saved: { size: number; path: string }[] = [];
  const warnings: string[] = [];
  return {
    saved,
    warnings,
    store,
    loadSettings: async () => ({ ...getDefaultSettings(), ...settings }),
    remux: async (blob, mimeType) => ({
      blob: new Blob([blob, 'cues'], { type: mimeType }),
      durationMs: 12_345,
      startOffsetMs: 0,
      remuxed: true,
    }),
    save: async (blob, path) => {
      saved.push({ size: blob.size, path });
      return { downloadId: saved.length, filename: `/dl/${path}` };
    },
    warn: (m) => warnings.push(m),
    ...overrides,
  };
}

const REFUSED = 'filename must not contain illegal characters';
const NOTHING_RECORDED =
  'nothing was recorded (stopped before the first audio or video sample); no file saved';

/** A save Firefox refuses for every path that matches `refused`; `attempts` lists every path. */
function refusingSave(refused: RegExp) {
  const attempts: string[] = [];
  const save: FinalizeDeps['save'] = async (_blob, path) => {
    attempts.push(path);
    if (refused.test(path)) throw new Error(REFUSED);
    return { downloadId: attempts.length, filename: `/dl/${path}` };
  };
  return { attempts, save };
}

/** The background's save (one queue around `saveBlobToDownloads`) on Firefox's downloads API. */
function firefoxSave() {
  const downloads = createFakeDownloads({ placeholderMs: 1, writeMs: 2 });
  const save = createSaveQueue((blob, path) =>
    saveBlobToDownloads(blob, path, { ...downloads.deps, pollMs: 1 }),
  );
  return { files: () => [...downloads.files.keys()], save };
}

describe('finalizeRecording', () => {
  afterEach(async () => store.close());

  it('assembles chunks in order, remuxes, saves, cleans up and reports', async () => {
    await seed();
    const onSaved = vi.fn();
    const d = deps({ onSaved });
    const result = await finalizeRecording(d)(meta.id, { recovered: false });
    expect(result).toMatchObject({
      status: 'saved',
      filename: '/dl/zen-recorder/2026-09-02_10-00_Standup.webm',
      byteSize: 8,
      durationMs: 12_345,
      recovered: false,
    });
    // A download id holds for one browser session only: the file is found again by its path.
    expect(result).not.toHaveProperty('downloadId');
    expect(d.saved).toEqual([{ size: 8, path: 'zen-recorder/2026-09-02_10-00_Standup.webm' }]);
    expect(await store.countChunks(meta.id)).toBe(0);
    expect(onSaved).toHaveBeenCalledWith({
      recordingId: meta.id,
      filename: '/dl/zen-recorder/2026-09-02_10-00_Standup.webm',
      chunkCount: 2,
      byteSize: 4,
      recovered: false,
    });
    expect(d.warnings).toEqual([]);
  });

  it('runs the remux cleanup after saving and flags video files', async () => {
    await seed();
    await store.updateRecording(meta.id, { mimeType: 'video/webm;codecs=vp9,opus' });
    const cleanup = vi.fn(async () => undefined);
    const d = deps({
      remux: async (blob, mimeType) => ({ ...remuxedTo(blob, mimeType), cleanup }),
    });
    const result = await finalizeRecording(d)(meta.id, { recovered: false });
    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ status: 'saved', hasVideo: true });
    expect(d.saved[0]?.path).toMatch(/\.webm$/);
  });

  it('warns when the remux cleanup fails but still succeeds', async () => {
    await seed();
    const d = deps({
      remux: async (blob, mimeType) => ({
        ...remuxedTo(blob, mimeType),
        cleanup: async () => {
          throw new Error('scratch locked');
        },
      }),
    });
    const result = await finalizeRecording(d)(meta.id, { recovered: false });
    expect(result?.status).toBe('saved');
    expect(d.warnings).toEqual(['cleanup failed: Error: scratch locked']);
  });

  it('adds the recovered suffix and keeps a raw copy when asked', async () => {
    await seed();
    const d = deps({}, { keepRawCopy: true });
    await finalizeRecording(d)(meta.id, { recovered: true });
    expect(d.saved.map((s) => s.path)).toEqual([
      'zen-recorder/2026-09-02_10-00_Standup (recovered).webm',
      'zen-recorder/2026-09-02_10-00_Standup (recovered) raw.webm',
    ]);
  });

  it('names the raw copy without the recovered suffix for normal endings', async () => {
    await seed();
    const d = deps({}, { keepRawCopy: true });
    await finalizeRecording(d)(meta.id, { recovered: false });
    expect(d.saved[1]?.path).toBe('zen-recorder/2026-09-02_10-00_Standup raw.webm');
  });

  it('tolerates a failing raw copy', async () => {
    await seed();
    let calls = 0;
    const d = deps(
      {
        save: async (_blob, path) => {
          calls++;
          if (calls === 2) throw new Error('disk full');
          return { downloadId: 1, filename: path };
        },
      },
      { keepRawCopy: true },
    );
    const result = await finalizeRecording(d)(meta.id, { recovered: false });
    expect(result?.status).toBe('saved');
    expect(d.warnings).toEqual(['raw copy failed: Error: disk full']);
  });

  it('falls back to the raw file (and the recorded duration) when remux fails, without a raw copy', async () => {
    await seed();
    const d = deps({ remux: async (blob) => notRemuxed(blob, 'bad ebml') }, { keepRawCopy: true });
    const result = await finalizeRecording(d)(meta.id, { recovered: false });
    expect(result).toMatchObject({ status: 'saved', durationMs: 5000, byteSize: 4 });
    expect(d.saved).toHaveLength(1);
    expect(d.warnings).toEqual(['remux failed, saving raw file: bad ebml']);
  });

  it('warns about a remux failure without an error message', async () => {
    await seed();
    const d = deps({ remux: async (blob) => notRemuxed(blob) });
    await finalizeRecording(d)(meta.id, { recovered: false });
    expect(d.warnings).toEqual(['remux failed, saving raw file: unknown']);
  });

  it('keeps the metadata duration undefined when neither side knows it', async () => {
    await seed();
    const { durationMs: _ignored, ...withoutDuration } = meta;
    await store.putRecording(withoutDuration);
    const d = deps({ remux: async (blob) => notRemuxed(blob) });
    const result = await finalizeRecording(d)(meta.id, { recovered: false });
    expect(result?.durationMs).toBeUndefined();
  });

  it('refuses to save a file whose first chunk (the header) is missing, and reports it', async () => {
    await seed([3, 4]);
    const onFailed = vi.fn();
    const d = deps({ onFailed });
    const result = await finalizeRecording(d)(meta.id, { recovered: false });
    const error = 'the first chunk (file header) was lost; nothing playable to save';
    expect(result).toMatchObject({ status: 'failed', error });
    expect(onFailed).toHaveBeenCalledWith(meta.id, error);
    expect(d.saved).toEqual([]);
    expect(await store.countChunks(meta.id)).toBe(2);
  });

  it('marks the recording failed when there are no chunks, and reports it', async () => {
    await seed([]);
    const onFailed = vi.fn();
    const result = await finalizeRecording(deps({ onFailed }))(meta.id, { recovered: false });
    expect(result).toMatchObject({ status: 'failed', error: 'no audio data was received' });
    expect(onFailed).toHaveBeenCalledWith(meta.id, 'no audio data was received');
  });

  // Record and Stop at once with video on: the page's only chunk is the 101-byte header.
  it('refuses to save a recording in which nothing was recorded, keeps its chunks and reports it', async () => {
    await seed([]);
    await store.updateRecording(meta.id, { mimeType: 'video/webm;codecs=vp9,opus' });
    const header = await buildHeaderOnlyWebm();
    await store.putChunk({
      recordingId: meta.id,
      seq: 0,
      blob: header,
      byteLength: header.size,
      receivedAt: 0,
    });
    const onFailed = vi.fn();
    const onSaved = vi.fn();
    const d = deps({ remux: (blob, mimeType) => remuxWebm(blob, mimeType), onFailed, onSaved });
    const result = await finalizeRecording(d)(meta.id, { recovered: false });
    expect(result).toMatchObject({ status: 'failed', error: NOTHING_RECORDED });
    expect(d.saved).toEqual([]);
    expect(onSaved).not.toHaveBeenCalled();
    expect(onFailed).toHaveBeenCalledWith(meta.id, NOTHING_RECORDED);
    expect(d.warnings).toEqual([]);
    expect(await store.countChunks(meta.id)).toBe(1);
    // A retry from the popup finds the same chunk and gives the same reason.
    expect(await finalizeRecording(d)(meta.id, { recovered: false })).toMatchObject({
      status: 'failed',
      error: NOTHING_RECORDED,
    });
  });

  it('warns about sequence gaps but still saves', async () => {
    await seed([0, 2]);
    const d = deps();
    const result = await finalizeRecording(d)(meta.id, { recovered: false });
    expect(result?.status).toBe('saved');
    expect(d.warnings).toEqual(['recording rec-1: chunk sequence gap at index 1']);
  });

  it('marks the recording failed and reports when saving throws, keeping the chunks', async () => {
    await seed();
    const onFailed = vi.fn();
    const d = deps({
      onFailed,
      save: async () => {
        throw new Error('quota');
      },
    });
    const result = await finalizeRecording(d)(meta.id, { recovered: false });
    expect(result).toMatchObject({ status: 'failed', error: 'quota' });
    expect(onFailed).toHaveBeenCalledWith(meta.id, 'quota');
    expect(await store.countChunks(meta.id)).toBe(2);
  });

  it('stringifies non-Error failures', async () => {
    await seed();
    const d = deps({
      save: async () => {
        throw 'weird';
      },
    });
    expect((await finalizeRecording(d)(meta.id, { recovered: false }))?.error).toBe('weird');
  });

  it('returns undefined for unknown ids and for concurrent calls on the same id', async () => {
    await seed();
    const finalize = finalizeRecording(deps());
    expect(await finalize('nope', { recovered: false })).toBeUndefined();
    const [first, second] = await Promise.all([
      finalize(meta.id, { recovered: false }),
      finalize(meta.id, { recovered: false }),
    ]);
    expect(first?.status).toBe('saved');
    expect(second).toBeUndefined();
  });

  it('works without a warn callback', async () => {
    await seed([0, 2]);
    const { warn: _ignored, ...d } = deps();
    expect((await finalizeRecording(d)(meta.id, { recovered: false }))?.status).toBe('saved');
  });

  it('saves under the dated fallback name when Firefox refuses the name, raw copy included', async () => {
    await seed();
    const { attempts, save } = refusingSave(/Standup/);
    const d = deps({ save }, { keepRawCopy: true });
    const result = await finalizeRecording(d)(meta.id, { recovered: true });
    expect(attempts).toEqual([
      'zen-recorder/2026-09-02_10-00_Standup (recovered).webm',
      'zen-recorder/2026-09-02_10-00_recording (recovered).webm',
      'zen-recorder/2026-09-02_10-00_recording (recovered) raw.webm',
    ]);
    expect(result).toMatchObject({
      status: 'saved',
      filename: '/dl/zen-recorder/2026-09-02_10-00_recording (recovered).webm',
    });
    expect(d.warnings).toEqual([
      `Firefox refused the file name zen-recorder/2026-09-02_10-00_Standup (recovered).webm (${REFUSED}); saving it as zen-recorder/2026-09-02_10-00_recording (recovered).webm`,
    ]);
    expect(await store.countChunks(meta.id)).toBe(0);
  });

  it('tries the fallback name once, and keeps the chunks when Firefox refuses it too', async () => {
    await seed();
    const { attempts, save } = refusingSave(/./);
    const result = await finalizeRecording(deps({ save }))(meta.id, { recovered: false });
    expect(result).toMatchObject({ status: 'failed', error: REFUSED });
    expect(attempts).toHaveLength(2);
    expect(await store.countChunks(meta.id)).toBe(2);
  });

  // Once a download exists, its file may be on disk (or still be written): another name could
  // leave a second file of the same recording.
  it.each([
    'download interrupted: FILE_FAILED',
    'download timed out',
    'download 1 is no longer in the download list',
  ])('does not try another name after the download started: %s', async (error) => {
    await seed();
    const attempts: string[] = [];
    const d = deps({
      save: async (_blob, path) => {
        attempts.push(path);
        throw new Error(error);
      },
    });
    const result = await finalizeRecording(d)(meta.id, { recovered: false });
    expect(result).toMatchObject({ status: 'failed', error });
    expect(attempts).toHaveLength(1);
  });

  describe("on Firefox's downloads API", () => {
    it.each([
      {
        name: 'a joined emoji and right-to-left marks',
        title: 'Dev 👨\u200D💻 sync \u200Fשלום\u200F',
        settings: {},
        files: [
          '/downloads/zen-recorder/2026-09-02_10-00_Dev 👨💻 sync שלום (recovered).webm',
          '/downloads/zen-recorder/2026-09-02_10-00_Dev 👨💻 sync שלום (recovered) raw.webm',
        ],
      },
      {
        name: 'a long CJK title',
        title: '会'.repeat(80),
        settings: { filenameTemplate: '{title}' },
        files: [
          `/downloads/zen-recorder/${'会'.repeat(66)} (recovered).webm`,
          `/downloads/zen-recorder/${'会'.repeat(66)} (recovered) raw.webm`,
        ],
      },
    ])('saves a recording whose title has $name', async ({ title, settings, files }) => {
      await seed();
      await store.updateRecording(meta.id, { title });
      const firefox = firefoxSave();
      const d = deps({ save: firefox.save }, { keepRawCopy: true, ...settings });
      const result = await finalizeRecording(d)(meta.id, { recovered: true });
      expect(result).toMatchObject({ status: 'saved', filename: files[0] });
      expect(firefox.files()).toEqual(files);
    });

    it('saves a refused name once, under the fallback name: one file, no second copy', async () => {
      await seed();
      const firefox = firefoxSave();
      const refusal = createNameRefusal(firefox.save);
      refusal.refuseNextName();
      const d = deps({ save: refusal.save });
      const result = await finalizeRecording(d)(meta.id, { recovered: false });
      expect(result).toMatchObject({
        status: 'saved',
        filename: '/downloads/zen-recorder/2026-09-02_10-00_recording.webm',
      });
      expect(firefox.files()).toEqual(['/downloads/zen-recorder/2026-09-02_10-00_recording.webm']);
      expect(d.warnings).toHaveLength(1);
    });
  });
});

describe('finalizeRecording remembers whether it saves a recovered recording', () => {
  afterEach(async () => store.close());

  // A retry, or the next recovery pass, reads it from the recording: the status no longer says
  // so once the save failed (`failed`) or stopped half way (`finalizing`).
  it.each([true, false])(
    'stores recovered: %s before it saves, so a save that fails keeps it',
    async (recovered) => {
      await seed();
      const failing = deps({
        save: async () => {
          throw new Error('download interrupted: FILE_FAILED');
        },
      });
      const result = await finalizeRecording(failing)(meta.id, { recovered });
      expect(result).toMatchObject({ status: 'failed', recovered });
    },
  );
});

describe('finalizeRecording says why it refused a recording', () => {
  afterEach(async () => store.close());

  /** A video recording whose only chunk is the 101-byte header: Record and Stop at once. */
  async function seedHeaderOnly(): Promise<void> {
    await seed([]);
    await store.updateRecording(meta.id, { mimeType: 'video/webm;codecs=vp9,opus' });
    const header = await buildHeaderOnlyWebm();
    await store.putChunk({
      recordingId: meta.id,
      seq: 0,
      blob: header,
      byteLength: header.size,
      receivedAt: 0,
    });
  }

  // A retry reads the same chunks and refuses again: the popup offers only Remove for these.
  it.each([
    { refusal: 'no-chunks', setUp: () => seed([]), error: 'no audio data was received' },
    {
      refusal: 'no-header',
      setUp: () => seed([3, 4]),
      error: 'the first chunk (file header) was lost; nothing playable to save',
    },
    { refusal: 'no-samples', setUp: seedHeaderOnly, error: NOTHING_RECORDED },
  ] as const)('stores $refusal next to the reason in words', async ({ refusal, setUp, error }) => {
    await setUp();
    const d = deps({ remux: (blob, mimeType) => remuxWebm(blob, mimeType) });
    const result = await finalizeRecording(d)(meta.id, { recovered: false });
    expect(result).toMatchObject({ status: 'failed', error, refusal });
  });

  it('stores no refusal for a save that failed, which a retry may fix', async () => {
    await seed();
    const failing = deps({
      save: async () => {
        throw new Error('download interrupted: FILE_FAILED');
      },
    });
    const result = await finalizeRecording(failing)(meta.id, { recovered: false });
    expect(result).toMatchObject({ status: 'failed' });
    expect(result).not.toHaveProperty('refusal');
  });
});
