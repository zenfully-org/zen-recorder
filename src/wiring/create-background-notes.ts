/**
 * The background's meeting notes: the writer, on a queue of its own, and what queues it. A
 * recording's save queues its notes; Retry save on a saved recording writes them again and waits;
 * the recovery pass queues every saved recording whose notes a stopped background left due.
 * Covered by the e2e run.
 */
import { browser } from '#imports';
import { createNotesWriter, type NotesWriterDeps } from '@/lib/background/create-notes-writer';
import { findNotesDue } from '@/lib/background/find-notes-due';

export function createBackgroundNotes(
  deps: Pick<NotesWriterDeps, 'events' | 'loadSettings' | 'save'> & {
    store: NotesWriterDeps['store'] & { listRecordings(): Promise<unknown[]> };
    warn: (message: string, detail?: unknown) => void;
  },
) {
  const writer = createNotesWriter({
    ...deps,
    timeZone: () => Intl.DateTimeFormat().resolvedOptions().timeZone,
    version: browser.runtime.getManifest().version,
    warn: (message) => deps.warn(message),
  });
  return {
    write: (recordingId: string) => writer.write(recordingId),
    writeNow: async (recordingId: string) => {
      writer.write(recordingId);
      await writer.whenIdle();
    },
    writeDue: async () => {
      for (const id of findNotesDue(await deps.store.listRecordings())) writer.write(id);
    },
  };
}
