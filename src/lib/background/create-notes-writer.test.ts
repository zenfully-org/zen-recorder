import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SaveBlob } from '@/lib/finalize/create-save-queue';
import { parseMeetingNotes } from '@/lib/notes/parse-meeting-notes';
import { getDefaultSettings } from '@/lib/settings/get-default-settings';
import { type ChunkStore, openChunkStore } from '@/lib/storage/open-chunk-store';
import { type EventStore, openEventStore } from '@/lib/storage/open-event-store';
import type { MeetingEvent, RecordingMeta, Settings } from '@/lib/types';
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
  { seq: 0, atMs: STARTED_AT, mediaMs: 0, type: 'recording-started' },
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
      ['zen-recorder/2026-10-09_10-00_Standup(1).md', { timeoutMs: 30_000 }],
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
    const { write, warnings } = setup(async () => {
      throw new Error('download timed out');
    });
    await write(saved());
    expect(await store.getRecording(ID)).toMatchObject({
      status: 'saved',
      notesState: 'failed',
      notesAttempts: 1,
      notesError: 'download timed out',
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
