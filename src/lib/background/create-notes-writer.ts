/**
 * Writes a saved recording's meeting notes: a Markdown file next to it, under its saved name with
 * `.md` (Firefox names a second file of the same name `X(1).webm`, so the notes follow the name
 * the recording got, not the template). It runs on a queue of its own, one recording at a time,
 * outside every tab's message queue: a notes save that hangs never holds a tab's chunks.
 *
 * The notes are built in the background, in the time zone the background was in when it first
 * stored the recording, from what it stored: the recording, its meeting events and the saved
 * file's facts. With the setting off no file is written. Once written, or skipped, the events are
 * deleted; a save that fails leaves the recording saved, keeps the events for the next attempt,
 * and says so in Diagnostics only: the recording, which is what matters, is on disk.
 */
import { notesEventsFrom } from '@/lib/background/notes-events-from';
import { buildDownloadPath } from '@/lib/finalize/build-download-path';
import type { SaveBlob } from '@/lib/finalize/create-save-queue';
import { buildMeetingNotes, type MeetingNotesInput } from '@/lib/notes/build-meeting-notes';
import { notesPathFor } from '@/lib/notes/notes-path-for';
import { renderMeetingNotes } from '@/lib/notes/render-meeting-notes';
import { parseRecordingMeta, type StoredRecordingMeta } from '@/lib/protocol/parse-recording-meta';
import { getProviderDescriptor } from '@/lib/providers/get-provider-descriptor';
import type { ChunkStore } from '@/lib/storage/open-chunk-store';
import type { EventStore } from '@/lib/storage/open-event-store';
import type { MeetingEvent, Settings } from '@/lib/types';

/** A text file this small is on disk in milliseconds: one that takes longer is stuck. */
const NOTES_TIMEOUT_MS = 30_000;
const NOTES_TYPE = 'text/markdown;charset=utf-8';

export interface NotesWriter {
  /** Queues the notes of saved recording `recordingId`. Never rejects: failures are logged. */
  write(recordingId: string): void;
  /** Resolves once every write queued so far has run. */
  whenIdle(): Promise<void>;
}

export interface NotesWriterDeps {
  store: Pick<ChunkStore, 'getRecording' | 'updateRecording'>;
  events: Pick<EventStore, 'getEvents' | 'deleteEvents'>;
  loadSettings(): Promise<Settings>;
  save: SaveBlob;
  /** The background's IANA time zone now, for a recording stored without one. */
  timeZone(): string;
  /** The extension's version, which the notes name as their generator. */
  version: string;
  warn(message: string): void;
}

/**
 * The events the page still held when the recording ended. A page that speaks events ends its
 * recordings with their counts; an end without them came from the bridge or the browser (Firefox
 * stopped a closing tab's script before its handover), and the stop the page stamped never left
 * it: at least that one is unsent.
 */
function unsentOf(meta: StoredRecordingMeta, events: readonly MeetingEvent[]): number | undefined {
  const endLost =
    meta.eventsProtocol >= 1 &&
    meta.eventCount === undefined &&
    !meta.recovered &&
    !events.some((event) => event.type === 'recording-stopped');
  return endLost ? 1 : meta.eventsUnsent;
}

/** What the notes are built from: the stored recording, its events and the saved file. */
function notesInput(
  meta: StoredRecordingMeta & { filename: string },
  events: readonly MeetingEvent[],
  settings: Settings,
  deps: Pick<NotesWriterDeps, 'timeZone' | 'version'>,
): MeetingNotesInput {
  const provider = getProviderDescriptor(meta.provider);
  return {
    recording: {
      id: meta.id,
      service: meta.provider,
      serviceName: provider.label,
      meetingId: meta.meetingCode,
      title: meta.title,
      url: provider.meetingUrl(meta.meetingCode),
      startedAt: meta.startedAt,
      lastChunkAt: meta.lastChunkAt,
      timeZone: meta.timeZone,
      hasVideo: meta.hasVideo,
      endReason: meta.endReason,
      eventsProtocol: meta.eventsProtocol,
      recovered: meta.recovered,
      eventCount: meta.eventCount,
      eventsDropped: meta.eventsDropped,
      eventsUnsent: unsentOf(meta, events),
    },
    events: notesEventsFrom(events, meta.hasVideo ? 'video' : 'audio'),
    file: {
      saved: meta.filename,
      raw: meta.rawFilename ?? null,
      durationMs: meta.durationMs ?? null,
      startOffsetMs: meta.startOffsetMs,
      remuxed: meta.remuxed,
    },
    notes: settings.meetingNotes === 'withoutNames' ? 'withoutNames' : 'withNames',
    // A page that numbered no event and held none collected none: notes were off while it recorded.
    notesOffWhileRecording: meta.eventCount === 0 && meta.eventsUnsent === 0 && events.length === 0,
    timeZone: deps.timeZone(),
    generatorVersion: deps.version,
    detectionLatencyMs: meta.tickMs,
  };
}

/** Where the notes go: next to the saved recording, or under the template's name in its folder. */
const notesPath = (meta: StoredRecordingMeta & { filename: string }, settings: Settings) =>
  notesPathFor(meta.filename, settings.downloadSubfolder) ??
  buildDownloadPath({
    template: settings.filenameTemplate,
    subfolder: settings.downloadSubfolder,
    title: meta.title,
    meetingCode: meta.meetingCode,
    provider: meta.provider,
    startedAt: meta.startedAt,
    extension: 'md',
  });

/** Writes the notes of one recording; rejects only when the store cannot be read or updated. */
async function writeNotes(deps: NotesWriterDeps, recordingId: string): Promise<void> {
  const meta = parseRecordingMeta(await deps.store.getRecording(recordingId));
  const filename = meta?.filename;
  if (meta?.status !== 'saved' || filename === undefined) return;
  // Written, or skipped, already: the startup pass may queue a recording its save just queued.
  if (meta.notesState === 'saved' || meta.notesState === 'skipped') return;
  const settings = await deps.loadSettings();
  if (settings.meetingNotes === 'off') {
    await deps.store.updateRecording(recordingId, { notesState: 'skipped' });
    await deps.events.deleteEvents(recordingId);
    return;
  }
  const saved = { ...meta, filename };
  try {
    const stored = await deps.events.getEvents(recordingId);
    const input = notesInput(
      saved,
      stored.map((row) => row.event),
      settings,
      deps,
    );
    const text = renderMeetingNotes(buildMeetingNotes(input));
    const file = await deps.save(
      new Blob([text], { type: NOTES_TYPE }),
      notesPath(saved, settings),
      {
        timeoutMs: NOTES_TIMEOUT_MS,
      },
    );
    await deps.store.updateRecording(recordingId, {
      notesState: 'saved',
      notesFilename: file.filename,
    });
    await deps.events.deleteEvents(recordingId);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await deps.store.updateRecording(recordingId, {
      notesState: 'failed',
      notesAttempts: meta.notesAttempts + 1,
      notesError: message,
    });
    deps.warn(`could not save the meeting notes of ${recordingId}: ${message}`);
  }
}

export function createNotesWriter(deps: NotesWriterDeps): NotesWriter {
  let queue: Promise<void> = Promise.resolve();
  return {
    write(recordingId) {
      // Caught per write: one rejected link would stop every write after it.
      queue = queue
        .then(() => writeNotes(deps, recordingId))
        .catch((error: unknown) =>
          deps.warn(`could not write the meeting notes of ${recordingId}: ${String(error)}`),
        );
    },
    whenIdle: () => queue,
  };
}
