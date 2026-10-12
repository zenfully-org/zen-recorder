import { openDB } from 'idb';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { findNotesDue } from '@/lib/background/find-notes-due';
import { createSaveQueue, type SaveBlob } from '@/lib/finalize/create-save-queue';
import { saveBlobToDownloads } from '@/lib/finalize/save-blob-to-downloads';
import { parseMeetingNotes } from '@/lib/notes/parse-meeting-notes';
import { getDefaultSettings } from '@/lib/settings/get-default-settings';
import { type ChunkStore, openChunkStore } from '@/lib/storage/open-chunk-store';
import { type EventStore, openEventStore } from '@/lib/storage/open-event-store';
import type { MeetingEvent, RecordingMeta, Settings } from '@/lib/types';
import { createFakeDownloads } from '@/test/fakes/create-fake-downloads';
import { startEvent } from '@/test/notes/start-event';
import { createNotesWriter } from './create-notes-writer';

const ID = '4f3c6d2a-9d7c-4a4e-9f1e-0c1b2a3d4e5f';
const STARTED_AT = Date.UTC(2026, 9, 9, 8, 0, 0);

/** A recording saved by this version, its notes due. */
const saved = (patch: Partial<RecordingMeta> = {}): RecordingMeta => ({
  id: ID,
  provider: 'meet',
  meetingCode: 'abc-defg-hij',
  title: 'Standup',
  startedAt: STARTED_AT,
  durationMs: 60_000,
  mimeType: 'video/webm;codecs=vp9,opus',
  status: 'saved',
  chunkCount: 20,
  byteSize: 4_000,
  filename: '/dl/zen-recorder/2026-10-09_10-00_Standup(1).webm',
  recovered: false,
  hasVideo: true,
  endReason: 'command',
  endCause: 'ended',
  eventsProtocol: 1,
  eventCount: 2,
  eventsDropped: 0,
  eventsUnsent: 0,
  timeZone: 'Europe/Berlin',
  tickMs: 1_000,
  notesState: 'pending',
  startOffsetMs: 0,
  remuxed: true,
  ...patch,
});

const EVENTS: MeetingEvent[] = [
  startEvent({ seq: 0, atMs: STARTED_AT, mediaMs: 0 }),
  {
    seq: 1,
    atMs: STARTED_AT + 60_000,
    mediaMs: 60_000,
    type: 'recording-stopped',
    reason: 'command',
  },
];

let counter = 0;
let store: ChunkStore;
let events: EventStore;

function setup(save?: SaveBlob) {
  store = openChunkStore(`notes-writer-${++counter}`);
  events = openEventStore(`notes-writer-${counter}-events`);
  const settings: { now: Settings } = { now: getDefaultSettings() };
  const warnings: string[] = [];
  const saves: { blob: Blob; path: string; options: unknown }[] = [];
  const saveNotes =
    save ??
    (async (blob: Blob, path: string, options?: unknown) => {
      saves.push({ blob, path, options });
      return { downloadId: saves.length, filename: `/dl/${path}` };
    });
  const writer = createNotesWriter({
    store,
    events,
    loadSettings: async () => settings.now,
    save: saveNotes,
    timeZone: () => 'Asia/Tokyo',
    version: '0.4.0',
    warn: (message) => warnings.push(message),
  });
  /** Stores `meta` and `stored` events, writes the notes, and waits for the writer. */
  const write = async (meta: RecordingMeta, stored: MeetingEvent[] = EVENTS) => {
    await store.putRecording(meta);
    await events.putBatch(meta.id, stored, 1);
    writer.write(meta.id);
    await writer.whenIdle();
  };
  /** The notes the last save wrote, as their data block reads. */
  const notes = async () => parseMeetingNotes((await saves.at(-1)?.blob.text()) ?? '');
  return { writer, write, settings, warnings, saves, notes };
}

describe('createNotesWriter', () => {
  afterEach(async () => Promise.all([store.close(), events.close()]));

  // Firefox names a second file of the same name `X(1).webm`: the notes follow the saved name.
  it('saves the notes next to the saved recording, under its name, and forgets the events', async () => {
    const { write, saves, notes } = setup();
    await write(saved());
    expect(saves.map(({ path, options }) => [path, options])).toEqual([
      [
        'zen-recorder/2026-10-09_10-00_Standup(1).md',
        { timeoutMs: 30_000, resumeFrom: undefined, remember: expect.any(Function) },
      ],
    ]);
    expect(saves[0]?.blob.type).toBe('text/markdown;charset=utf-8');
    expect(await notes()).toMatchObject({
      meeting: { service: 'meet', id: 'abc-defg-hij', url: 'https://meet.google.com/abc-defg-hij' },
      capture: { events: 'complete', eventsMissingReason: null, detectionLatencyMs: 1_000 },
      events: [
        { seq: 0, type: 'recording-started' },
        { seq: 1, type: 'recording-stopped' },
      ],
    });
    expect(await store.getRecording(ID)).toMatchObject({
      notesState: 'saved',
      notesFilename: '/dl/zen-recorder/2026-10-09_10-00_Standup(1).md',
    });
    expect(await events.countEvents(ID)).toBe(0);
  });

  it('keeps the recording saved and its events when the notes cannot be saved, and says so once', async () => {
    const { write, warnings } = setup(async (_blob, _path, options) => {
      await options?.remember?.('blob:notes');
      expect(await store.getRecording(ID)).toMatchObject({ notesDownloadUrl: 'blob:notes' });
      throw new Error('download timed out');
    });
    await write(saved());
    // The next attempt saves them again: the person may have removed what this one saved.
    expect(await store.getRecording(ID)).toMatchObject({
      status: 'saved',
      notesState: 'failed',
      notesAttempts: 1,
      notesError: 'download timed out',
      notesDownloadUrl: undefined,
    });
    expect(await events.countEvents(ID)).toBe(2);
    expect(warnings).toEqual([`could not save the meeting notes of ${ID}: download timed out`]);
  });

  it('writes no file with the notes off, and forgets the events', async () => {
    const { write, settings, saves } = setup();
    settings.now = { ...settings.now, meetingNotes: 'off' };
    await write(saved());
    expect(saves).toEqual([]);
    expect(await store.getRecording(ID)).toMatchObject({ notesState: 'skipped' });
    expect(await events.countEvents(ID)).toBe(0);
  });

  it('saves the notes of two recordings one after the other', async () => {
    const order: string[] = [];
    let release = (): void => undefined;
    const { writer } = setup(async (_blob, path) => {
      order.push(`start ${path}`);
      if (order.length === 1) {
        await new Promise<void>((resolve) => {
          release = resolve;
        });
      }
      order.push(`end ${path}`);
      return { downloadId: 1, filename: `/dl/${path}` };
    });
    await store.putRecording(saved());
    await store.putRecording(saved({ id: 'r2', filename: '/dl/zen-recorder/b.webm' }));
    writer.write(ID);
    writer.write('r2');
    await vi.waitFor(() => expect(order).toHaveLength(1));
    release();
    await writer.whenIdle();
    expect(order).toEqual([
      'start zen-recorder/2026-10-09_10-00_Standup(1).md',
      'end zen-recorder/2026-10-09_10-00_Standup(1).md',
      'start zen-recorder/b.md',
      'end zen-recorder/b.md',
    ]);
  });
});

describe('createNotesWriter, what the notes say about the events', () => {
  afterEach(async () => Promise.all([store.close(), events.close()]));

  // Recorded by 0.3.0: no events, no zone. The notes say the page session was too old.
  it('writes header-only notes for a recording from an older page session, in the current zone', async () => {
    const { write, notes } = setup();
    const {
      eventsProtocol: _protocol,
      eventCount: _count,
      timeZone: _zone,
      tickMs: _tick,
      ...older
    } = saved();
    await write(older, []);
    expect(await notes()).toMatchObject({
      capture: { events: 'none', eventsMissingReason: 'page-session-too-old' },
      recording: { timeZone: 'Asia/Tokyo' },
      events: [],
    });
  });

  it('says the notes were off while it recorded, for a page that counted no event', async () => {
    const { write, notes } = setup();
    await write(saved({ eventCount: 0, eventsUnsent: 0 }), []);
    expect(await notes()).toMatchObject({
      capture: { events: 'none', eventsMissingReason: 'notes-off-during-recording' },
    });
  });

  // A meeting of hundreds: past its cap the background stored only what frames the timeline.
  it('says the events the background did not store past its cap were dropped', async () => {
    const { write, notes } = setup();
    const [start, stop] = EVENTS;
    const after = stop ? [{ ...stop, seq: 2 }] : [];
    await write(saved({ eventCount: 3, eventsCapped: 1, eventsCappedThrough: 1 }), [
      ...(start ? [start] : []),
      ...after,
    ]);
    expect(await notes()).toMatchObject({
      capture: { events: 'incomplete', eventsMissingReason: 'events-dropped' },
    });
  });

  // The tab closed: its end came in the handover, and its stop never left the page.
  it('says the events a closed tab still held never arrived', async () => {
    const { write, notes } = setup();
    const [start] = EVENTS;
    await write(
      saved({ endReason: 'pagehide', eventCount: 1, eventsUnsent: 1 }),
      start ? [start] : [],
    );
    expect(await notes()).toMatchObject({
      capture: { events: 'incomplete', eventsMissingReason: 'events-unsent' },
    });
  });

  // Firefox can stop a closing tab's script before its handover: the end then comes from the
  // bridge or the browser, without the page's counts, and the stop the page stamped never left it.
  it("says the stop never arrived when the page's own end did not, and only then", async () => {
    const { write, notes } = setup();
    const {
      eventCount: _count,
      eventsUnsent: _unsent,
      ...fallback
    } = saved({ endReason: 'pagehide' });
    const [start] = EVENTS;
    await write(fallback, start ? [start] : []);
    expect(await notes()).toMatchObject({
      capture: { events: 'incomplete', eventsMissingReason: 'events-unsent' },
    });
    await write({ ...fallback, id: 'stopped' });
    expect(await notes()).toMatchObject({ capture: { events: 'complete' } });
  });

  it('writes no name with the timeline only', async () => {
    const { write, settings, notes } = setup();
    settings.now = { ...settings.now, meetingNotes: 'withoutNames' };
    await write(saved());
    expect(await notes()).toMatchObject({ capture: { names: false } });
  });
});

describe('createNotesWriter, the file it describes', () => {
  afterEach(async () => Promise.all([store.close(), events.close()]));

  it('names the raw copy beside an audio-only recording, and a length it could not read', async () => {
    const { write, notes } = setup();
    const { durationMs: _length, ...unmeasured } = saved({
      hasVideo: false,
      mimeType: 'audio/webm;codecs=opus',
      rawFilename: '/dl/zen-recorder/2026-10-09_10-00_Standup raw.webm',
    });
    await write(unmeasured);
    expect(await notes()).toMatchObject({
      recording: { rawFile: '2026-10-09_10-00_Standup raw.webm', durationMs: null },
      events: [{ type: 'recording-started', media: 'audio' }, { type: 'recording-stopped' }],
    });
  });

  it('says how long the recording was paused, as its end said', async () => {
    const { write, notes } = setup();
    await write(saved({ pausedMs: 4_000 }));
    expect((await notes())?.recording.pausedMs).toBe(4_000);
  });

  it('says why a save failed however the failure is told', async () => {
    const { write } = setup(() => Promise.reject('disk full'));
    await write(saved());
    expect(await store.getRecording(ID)).toMatchObject({ notesError: 'disk full' });
  });
});

describe('createNotesWriter, what it leaves alone', () => {
  afterEach(async () => Promise.all([store.close(), events.close()]));

  // The startup pass can queue a recording its save just queued: a second file would be a copy.
  it('writes the notes of a recording once', async () => {
    const { writer, write, saves } = setup();
    await write(saved());
    writer.write(ID);
    await writer.whenIdle();
    await write(saved({ id: 'off', notesState: 'skipped' }));
    expect(saves).toHaveLength(1);
  });

  it('writes nothing for a recording that is not saved, or that it cannot read', async () => {
    const { write, saves } = setup();
    await write(saved({ status: 'failed' }));
    const { filename: _filename, ...unsaved } = saved({ id: 'r2' });
    await write(unsaved);
    await write({ ...saved({ id: 'r3' }), chunkCount: -1 });
    expect(saves).toEqual([]);
  });

  // A name with nothing before its extension gets the template's name in the recording's folder.
  it('names the notes after the recording when its saved name has no name of its own', async () => {
    const { write, settings, saves } = setup();
    settings.now = { ...settings.now, filenameTemplate: '{title}' };
    await write(saved({ filename: '/dl/zen-recorder/.webm' }));
    expect(saves[0]?.path).toBe('zen-recorder/Standup.md');
  });

  // One write that fails before it can even say so must not stop the ones after it.
  it('goes on with the next recording when one cannot be read at all', async () => {
    const { writer, warnings, saves } = setup();
    const failure = new Error('database closed');
    const getRecording = vi.spyOn(store, 'getRecording').mockRejectedValueOnce(failure);
    await store.putRecording(saved());
    writer.write('broken');
    writer.write(ID);
    await writer.whenIdle();
    expect(getRecording).toHaveBeenCalledTimes(2);
    expect(saves).toHaveLength(1);
    expect(warnings).toEqual([
      'could not write the meeting notes of broken: Error: database closed',
    ]);
  });
});

describe('createNotesWriter, after a background that stopped while it saved them', () => {
  afterEach(async () => Promise.all([store.close(), events.close()]));

  const NOTES = '/dl/zen-recorder/2026-10-09_10-00_Standup(1).md';

  /**
   * One browser session's downloads, and a background's save on them: each background has its own
   * queue. `stops: 'after-download'` is a background that stops right after Firefox completed its
   * download, before it hears so; `'mid-download'` one that stops while Firefox still writes it,
   * which `holdWrites` keeps it doing until the test calls `finishWrites()`.
   */
  function firefox(options: { holdWrites?: boolean } = {}) {
    const downloads = createFakeDownloads({ dir: '/dl', placeholderMs: 1, writeMs: 2, ...options });
    const background = (stops?: 'after-download' | 'mid-download'): SaveBlob => {
      const save = createSaveQueue((blob, path, own) =>
        saveBlobToDownloads(blob, path, { ...downloads.deps, pollMs: 1, ...own }),
      );
      if (stops === undefined) return save;
      return async (...args) => {
        const saving = save(...args);
        if (stops === 'after-download') await saving;
        return new Promise(() => undefined);
      };
    };
    return { downloads, background, files: () => [...downloads.files.keys()] };
  }

  /** A background that starts after the first stopped, and writes the notes still due. */
  async function nextBackground(save: SaveBlob): Promise<void> {
    const writer = createNotesWriter({
      store,
      events,
      loadSettings: async () => getDefaultSettings(),
      save,
      timeZone: () => 'Asia/Tokyo',
      version: '0.4.0',
      warn: () => undefined,
    });
    for (const id of findNotesDue(await store.listRecordings())) writer.write(id);
    await writer.whenIdle();
  }

  /** The first background queues the notes of a saved recording and stops as `stops` says. */
  async function firstBackground(
    browser: ReturnType<typeof firefox>,
    stops: 'after-download' | 'mid-download',
  ): Promise<void> {
    const { writer } = setup(browser.background(stops));
    await store.putRecording(saved());
    await events.putBatch(ID, EVENTS, 1);
    writer.write(ID);
    if (stops === 'after-download') {
      await vi.waitFor(() => expect(browser.downloads.files.get(NOTES)?.size).toBeGreaterThan(0));
    } else {
      await vi.waitFor(() => expect(browser.downloads.files.has(NOTES)).toBe(true));
    }
  }

  // An update or a reload right after the save: Firefox still lists the download it completed.
  it('keeps the notes the stopped background saved instead of saving a second copy', async () => {
    const browser = firefox();
    await firstBackground(browser, 'after-download');
    expect(await store.getRecording(ID)).toMatchObject({ notesState: 'pending' });
    await nextBackground(browser.background());
    expect(browser.files()).toEqual([NOTES]);
    expect(await store.getRecording(ID)).toMatchObject({
      notesState: 'saved',
      notesFilename: NOTES,
    });
    expect(await events.countEvents(ID)).toBe(0);
  });

  it('waits for the notes Firefox was still saving when the background stopped', async () => {
    // Firefox writes the notes only when the test says so: a write on a timer can end before the
    // next background starts when the run is slow.
    const browser = firefox({ holdWrites: true });
    await firstBackground(browser, 'mid-download');
    expect(browser.downloads.files.get(NOTES)?.size).toBe(0);
    // Spied after the first background started its save: every call is the next background's.
    const search = vi.spyOn(browser.downloads.deps, 'search');
    const next = nextBackground(browser.background()).then(
      () => browser.downloads.files.get(NOTES)?.size,
    );
    // It found the download by its address, still running, and asked again how it is going.
    await vi.waitFor(() =>
      expect(search.mock.calls.slice(0, 2)).toEqual([
        [{ url: expect.any(String) }],
        [{ id: expect.any(Number) }],
      ]),
    );
    browser.downloads.finishWrites();
    // Done only once Firefox wrote them.
    expect(await next).toBeGreaterThan(0);
    expect(browser.files()).toEqual([NOTES]);
    expect(await browser.downloads.files.get(NOTES)?.text()).toContain('Standup');
    expect(await store.getRecording(ID)).toMatchObject({
      notesState: 'saved',
      notesFilename: NOTES,
    });
  });

  // After a browser restart Firefox lists no finished download: a copy is better than no notes.
  it('saves the notes again after a browser restart, as a second file', async () => {
    const browser = firefox();
    await firstBackground(browser, 'after-download');
    browser.downloads.restart();
    await nextBackground(browser.background());
    const copy = '/dl/zen-recorder/2026-10-09_10-00_Standup(1)(1).md';
    expect(browser.files()).toEqual([NOTES, copy]);
    expect(await store.getRecording(ID)).toMatchObject({
      notesState: 'saved',
      notesFilename: copy,
    });
  });
});

describe('createNotesWriter, how the recording started', () => {
  afterEach(async () => Promise.all([store.close(), events.close()]));

  const EARLIER = '4f3c6d2a-9d7c-4a4e-9f1e-0c1b2a3d4e50';
  const FACTS = {
    cause: 'restart-after-video-failure',
    audioOnlyReason: 'video-failed',
    continuesRecordingId: EARLIER,
    gapMs: 140,
  } as const;
  const restarted = (): MeetingEvent[] => [
    startEvent({ seq: 0, atMs: STARTED_AT, mediaMs: 0 }, { ...FACTS, media: 'audio' }),
    ...EVENTS.slice(1),
  ];
  const audioOnly = { hasVideo: false, mimeType: 'audio/webm;codecs=opus' };

  // Firefox may have named the earlier file `X(1).webm`: the notes name it as it was saved.
  it('names the file the recording goes on from by the name it was saved under', async () => {
    const { write, notes } = setup();
    const earlier = saved({
      id: EARLIER,
      filename: '/dl/zen-recorder/2026-10-09_09-50_Standup.webm',
    });
    await store.putRecording({ ...earlier, notesState: 'saved' });
    await write(saved(audioOnly), restarted());
    expect((await notes())?.recording).toMatchObject({
      startCause: 'restart-after-video-failure',
      audioOnlyReason: 'video-failed',
      continues: { recordingId: EARLIER, file: '2026-10-09_09-50_Standup.webm', gapMs: 140 },
    });
  });

  it('names no file when the recording it goes on from is not saved, or gone', async () => {
    const { write, notes } = setup();
    const { filename: _name, ...saving } = saved({ id: EARLIER, status: 'finalizing' });
    await store.putRecording(saving);
    await write(saved(audioOnly), restarted());
    expect((await notes())?.recording.continues).toEqual({
      recordingId: EARLIER,
      file: null,
      gapMs: 140,
    });
    await store.deleteRecording(EARLIER);
    await write(saved({ ...audioOnly, id: 'later' }), restarted());
    expect((await notes())?.recording.continues).toMatchObject({ file: null });
  });

  // The announcement reaches the background even when the start event never does.
  it('says why it started from its announcement when its start event never arrived', async () => {
    const { write, notes } = setup();
    const announced = {
      startCause: FACTS.cause,
      audioOnlyReason: FACTS.audioOnlyReason,
      continuesRecordingId: EARLIER,
      gapMs: 140,
    } as const;
    await write(
      saved({ ...audioOnly, ...announced, eventCount: 1, eventsUnsent: 1 }),
      EVENTS.slice(1),
    );
    expect((await notes())?.recording).toMatchObject({
      startCause: 'restart-after-video-failure',
      audioOnlyReason: 'video-failed',
      continues: { recordingId: EARLIER, gapMs: 140 },
    });
    // The first recording of a meeting, with video: its announcement says only why it started.
    await write(saved({ id: 'first', startCause: 'manual', eventCount: 1, eventsUnsent: 1 }), []);
    expect((await notes())?.recording).toMatchObject({
      startCause: 'manual',
      audioOnlyReason: null,
      continues: null,
    });
  });

  // A background of the first notes release stored the start with nothing known about it.
  it('reads a start stored by an older background, and leaves out a row it cannot read', async () => {
    const { writer, notes } = setup();
    await store.putRecording(saved());
    await events.putBatch(ID, EVENTS.slice(1), 1);
    const raw = await openDB(`notes-writer-${counter}-events`);
    await raw.put('events', {
      recordingId: ID,
      seq: 0,
      event: { seq: 0, atMs: STARTED_AT, mediaMs: 0, type: 'recording-started' },
      receivedAt: 1,
    });
    await raw.put('events', { recordingId: ID, seq: 2, event: { seq: 2 }, receivedAt: 1 });
    raw.close();
    writer.write(ID);
    await writer.whenIdle();
    expect((await notes())?.events).toMatchObject([
      { type: 'recording-started', cause: null, media: 'video', continuesRecordingId: null },
      { type: 'recording-stopped' },
    ]);
  });
});
