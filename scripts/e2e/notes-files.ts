/**
 * The meeting notes next to a saved recording, for the e2e scenarios: where they are, waiting for
 * them, and reading their data block with the format's own parser.
 */
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { type MeetingNotesDocument, parseMeetingNotes } from '@/lib/notes/parse-meeting-notes';
import { waitFor } from './harness';

/** The notes file of saved recording `webm`: its name with `.md` for its extension, beside it. */
export const notesFor = (webm: string): string => webm.replace(/\.[^./]+$/, '.md');

/** The notes as written, and their data block as the format's parser reads it. */
interface NotesFile {
  text: string;
  document: MeetingNotesDocument;
}

/** Reads notes file `md`; null while it is missing, or not complete yet. */
async function readNotes(md: string): Promise<NotesFile | null> {
  if (!existsSync(md)) return null;
  const text = await readFile(md, 'utf8');
  const document = parseMeetingNotes(text);
  return document ? { text, document } : null;
}

/** Waits until the notes of saved recording `webm` are on disk and read whole. */
export async function waitForNotes(webm: string, timeoutMs = 30_000): Promise<NotesFile> {
  return waitFor(`the notes of ${webm}`, () => readNotes(notesFor(webm)), timeoutMs);
}
