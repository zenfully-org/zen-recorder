import { parseRecordingMeta } from '@/lib/protocol/parse-recording-meta';

/** How many failed attempts a recording's notes get before only Retry save tries again. */
const MAX_ATTEMPTS = 3;

/**
 * The saved recordings whose meeting notes are still to write: due, or failed fewer than three
 * times. A background that stopped between a recording's save and its notes writes them at its
 * next start. A recording saved before the notes existed has no state, and gets none.
 */
export function findNotesDue(recordings: readonly unknown[]): string[] {
  return recordings.flatMap((input) => {
    const meta = parseRecordingMeta(input);
    const due =
      meta?.status === 'saved' &&
      (meta.notesState === 'pending' ||
        (meta.notesState === 'failed' && meta.notesAttempts < MAX_ATTEMPTS));
    return due ? [meta.id] : [];
  });
}
