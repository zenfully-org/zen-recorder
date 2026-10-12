// @vitest-environment node
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { renderMeetingNotes } from '@/lib/notes/render-meeting-notes';
import { EXAMPLE_NOTES } from '@/test/notes/example-notes-document';
import { waitForNotes } from './notes-files';

/** The notes of the recording saved as `file`, as a notes file holds them. */
const notesNaming = (file: string) =>
  renderMeetingNotes({ ...EXAMPLE_NOTES, recording: { ...EXAMPLE_NOTES.recording, file } });

describe('waitForNotes', () => {
  let folder = '';
  beforeEach(async () => {
    folder = await mkdtemp(path.join(tmpdir(), 'notes-files-'));
  });
  afterEach(async () => rm(folder, { recursive: true, force: true }));

  it('finds the notes under the name of their recording', async () => {
    await writeFile(path.join(folder, 'Sync.md'), notesNaming('Sync.webm'));
    const notes = await waitForNotes(path.join(folder, 'Sync.webm'), 1_000);
    expect(notes.md).toBe(path.join(folder, 'Sync.md'));
  });

  // An extension restart between saving a recording's notes and marking them saved has the next
  // background write them again: as `Sync(1).md`, the name the next recording's notes meant to use.
  it("finds the notes that name the recording when another recording's notes took its name", async () => {
    await writeFile(path.join(folder, 'Sync.md'), notesNaming('Sync.webm'));
    await writeFile(path.join(folder, 'Sync(1).md'), notesNaming('Sync.webm'));
    await writeFile(path.join(folder, 'Sync(1)(1).md'), notesNaming('Sync(1).webm'));
    const notes = await waitForNotes(path.join(folder, 'Sync(1).webm'), 1_000);
    expect(notes.document.recording.file).toBe('Sync(1).webm');
    expect(notes.md).toBe(path.join(folder, 'Sync(1)(1).md'));
  });
});
