/**
 * The meeting notes next to a saved recording, for the e2e scenarios: where they are, waiting for
 * them, and reading their data block with the format's own parser.
 *
 * Notes are saved under their recording's name with `.md`, but Firefox gives a name already on
 * disk a number (`X(1).md`), and a recording's notes can take another's name: when the extension
 * restarts between saving a recording's notes and marking them saved, the next background writes
 * them once more, as `X(1).md`, the name the recording saved as `X(1).webm` meant to use. The
 * format matches a pair by the file the notes name inside (`recording.file`); so does this.
 */
import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { type MeetingNotesDocument, parseMeetingNotes } from '@/lib/notes/parse-meeting-notes';
import { waitFor } from './harness';

/** Where the notes of saved recording `webm` are meant to be: its name with `.md`, beside it. */
export const notesFor = (webm: string): string => webm.replace(/\.[^./]+$/, '.md');

/** A notes file as written, where it is, and its data block as the format's parser reads it. */
interface NotesFile {
  md: string;
  text: string;
  document: MeetingNotesDocument;
}

/** Reads notes file `md`; null while it is missing, or not complete yet. */
async function readNotes(md: string): Promise<NotesFile | null> {
  if (!existsSync(md)) return null;
  const text = await readFile(md, 'utf8');
  const document = parseMeetingNotes(text);
  return document ? { md, text, document } : null;
}

/** The notes beside saved recording `webm` that name it: under its name first, then any other. */
async function readNotesOf(webm: string): Promise<NotesFile | null> {
  const folder = path.dirname(webm);
  const named = notesFor(webm);
  const others = (await readdir(folder))
    .filter((name) => name.endsWith('.md'))
    .map((name) => path.join(folder, name))
    .filter((md) => md !== named);
  for (const md of [named, ...others]) {
    const notes = await readNotes(md);
    if (notes?.document.recording.file === path.basename(webm)) return notes;
  }
  return null;
}

/** Waits until the notes of saved recording `webm` are on disk and read whole. */
export async function waitForNotes(webm: string, timeoutMs = 30_000): Promise<NotesFile> {
  return waitFor(`the notes of ${webm}`, () => readNotesOf(webm), timeoutMs);
}
