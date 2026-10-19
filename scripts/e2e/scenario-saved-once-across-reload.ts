/**
 * E2e scenario 98, run against every provider's fixture page right after scenario 90: a recording
 * and its meeting notes are saved once, each under the name it asked for, when the extension
 * restarts (an update, a reload) right after Firefox saved the file and before the background
 * heard so.
 *
 *   - An audio-only recording is stopped. The background's save of the `.webm` answers only once
 *     released (`save:hold-after-next-webm`): Firefox completes the download, and the recording
 *     stays `finalizing`. The extension reloads right then.
 *   - The next background's recovery pass saves the recording. Its notes' save answers only once
 *     released (`save:hold-after-next-md`): Firefox completes the `.md`, the notes stay
 *     `pending`, and the extension reloads again.
 *   - The background after that writes the notes still due, in its recovery pass.
 *
 * A test build runs the recovery pass 10 s after a background starts (`TEST_BUILD_TIMINGS`; 30 s
 * in a release): the run waits for what each pass does, not for the time.
 *
 * The run then wants one `.webm` and one `.md`, side by side under the names asked for, the
 * recording stored with both, and the notes naming the recording inside. A background that saves
 * again leaves `X(1).webm`, whose notes take `X(1).md`, and a second copy of those as
 * `X(1)(1).md`. Every file is printed and every check is made before the scenario fails.
 */
import { existsSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import type { Page } from 'puppeteer';
import { z } from 'zod';
import {
  backgroundDiagnostics,
  currentRecordingId,
  DOWNLOAD_DIR,
  listWebm,
  newRecordings,
  openMeeting,
  pressCardButton,
  probe,
  type StoredRecording,
  sleep,
  storedRecording,
  waitFor,
  waitForCompleteFile,
  waitForNewRecording,
} from './harness';
import { notesFor, waitForNotes } from './notes-files';
import type { ScenarioContext, ScenarioRegistration } from './order-scenarios';
import { reloadExtension } from './reload-extension';
import { meetingUrl } from './targets';
import { waitForEveryTrack } from './wait-for-every-track';

/** The recovery pass and the notes still due run `recoveryDelayMs` after a background starts. */
const NEXT_BACKGROUND_MS = 90_000;

const videoModeSchema = z.object({ videoMode: z.string() });
const downloadsSchema = z.object({
  downloads: z.array(z.object({ id: z.number(), filename: z.string(), state: z.string() })),
});

/** What this scenario prints of a stored recording: its files and its notes. */
function shown(recording: StoredRecording | undefined) {
  if (recording === undefined) return undefined;
  const { id, status, chunkCount, filename, notesState, notesFilename } = recording;
  return { id, status, chunkCount, filename, notesState, notesFilename };
}

/** Waits until Firefox lists the download of `file` as complete in this browser session. */
async function waitForCompleteDownload(page: Page, file: string): Promise<void> {
  await waitFor(
    `Firefox listing the download of ${path.basename(file)} as complete`,
    async () => {
      const { downloads } = downloadsSchema.parse(await probe(page, 'downloads:list'));
      return downloads.some((item) => item.filename === file && item.state === 'complete');
    },
    15_000,
  );
}

/** Every notes file in the downloads folder. */
async function listNotes(): Promise<string[]> {
  if (!existsSync(DOWNLOAD_DIR)) return [];
  const entries = await readdir(DOWNLOAD_DIR, { recursive: true, withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
    .map((entry) => path.join(entry.parentPath, entry.name));
}

/** Records a few seconds, audio only, and stops with the `.webm`'s answer held; returns its id. */
async function recordAndHoldTheSave(page: Page, before: ReadonlySet<string>) {
  const video = videoModeSchema.safeParse(await probe(page, 'settings:video-off'));
  if (!video.success || video.data.videoMode !== 'off') {
    throw new Error('could not switch video off through the debug probe');
  }
  await page.click('#start');
  const id = await waitFor('recording', () => currentRecordingId(page), 20_000);
  await waitForEveryTrack(page, id);
  await sleep(2_000);
  await probe(page, 'save:hold-after-next-webm');
  await pressCardButton(page, 'Stop');
  const webm = await waitForNewRecording(before);
  await waitForCompleteDownload(page, webm);
  const left = await storedRecording(page, id);
  console.log(`  ${path.basename(webm)} saved by Firefox; the recording is ${left?.status}`);
  if (left?.status !== 'finalizing') {
    throw new Error(`the recording is ${left?.status}, not finalizing, once Firefox saved it`);
  }
  return { id, webm };
}

/** What the folder and the store hold for the recording, against what it should hold. */
async function check(
  control: Page,
  recording: { id: string; webm: string },
  files: { webm: string[]; md: string[] },
): Promise<string[]> {
  const { id, webm } = recording;
  const md = notesFor(webm);
  for (const file of [...files.webm, ...files.md]) console.log(`  in the folder: ${file}`);
  const final = await storedRecording(control, id);
  console.log(`  stored recording: ${JSON.stringify(shown(final))}`);
  for (const line of (await backgroundDiagnostics(control)).filter((l) => l.includes(id))) {
    console.log(`  diagnostics: ${line}`);
  }
  const problems = [
    ...(files.webm.length === 1 ? [] : [`${files.webm.length} recording files instead of 1`]),
    ...(files.md.length === 1 ? [] : [`${files.md.length} notes files instead of 1`]),
    ...(final?.filename === webm ? [] : [`the recording is stored as ${final?.filename}`]),
    ...(final?.notesFilename === md ? [] : [`its notes are stored as ${final?.notesFilename}`]),
  ];
  if (existsSync(md)) {
    const { document } = await waitForNotes(webm);
    console.log(`  ${path.basename(md)} names ${document.recording.file}`);
  } else {
    problems.push(`no notes next to it as ${path.basename(md)}`);
  }
  return problems;
}

export async function scenarioSavedOnceAcrossReload({
  browser,
  target,
}: ScenarioContext): Promise<void> {
  console.log(
    `▶ ${target.id} scenario 98: a recording and its notes are saved once when the extension restarts right after Firefox saved them`,
  );
  const before = new Set(await listWebm());
  const notesBefore = new Set(await listNotes());
  const page = await openMeeting(browser, meetingUrl(target));
  let control = page;
  try {
    const recording = await recordAndHoldTheSave(page, before);
    await page.close();
    control = await reloadExtension(browser, target);
    console.log('  extension reloaded before the background heard the recording was saved');
    await probe(control, 'save:hold-after-next-md');
    await waitFor(
      'the next background saving the recording',
      async () => (await storedRecording(control, recording.id))?.status === 'saved',
      NEXT_BACKGROUND_MS,
    );
    const notes = await waitFor(
      'a notes file saved by Firefox',
      async () => (await listNotes()).find((file) => !notesBefore.has(file)),
      30_000,
    );
    await waitForCompleteFile(notes);
    await waitForCompleteDownload(control, notes);
    const pending = await storedRecording(control, recording.id);
    console.log(`  ${path.basename(notes)} saved by Firefox; the notes are ${pending?.notesState}`);
    await control.close();
    control = await reloadExtension(browser, target);
    console.log('  extension reloaded before the background heard the notes were saved');
    await waitFor(
      'the next background marking the notes saved',
      async () => (await storedRecording(control, recording.id))?.notesState === 'saved',
      NEXT_BACKGROUND_MS,
    );
    const problems = await check(control, recording, {
      webm: await newRecordings(before),
      md: (await listNotes()).filter((file) => !notesBefore.has(file)),
    });
    if (problems.length > 0) throw new Error(problems.join('; '));
  } finally {
    if (!control.isClosed()) {
      await probe(control, 'settings:video-on');
      await control.close();
    }
  }
}

export const registration = {
  name: '98',
  after: '90',
  scenario: scenarioSavedOnceAcrossReload,
} satisfies ScenarioRegistration;
