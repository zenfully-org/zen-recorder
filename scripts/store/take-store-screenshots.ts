/**
 * Retakes the store listing's four screenshots, `docs/store/images/screenshot-*.png`, in one run
 * of the end-to-end browser on the fake Google Meet page:
 *   1. the status card, open, in a call that records;
 *   2. the toolbar popup over the call, with the call being recorded and a saved recording;
 *   3. the Options page;
 *   4. the saved recording beside its notes: the two files in their folder, a frame of the
 *      recording, and the notes as written from their title (`excerptNotes` says where they end).
 *
 * The call is "Weekly product sync" with the fake page's invented people (You, Remote Person) and
 * Guest Two, camera off. The first recording starts by itself once someone else is in the call
 * and is stopped from the card after a minute (its file and its notes); the second is started
 * from the card and runs while the popup is drawn. For the pictures only, the page's test bench
 * is hidden and its cameras show calm drawings (`dressCallForPictures`). Firefox runs with
 * `TZ=UTC` and in English, so no picture names the machine's time zone or language. The popup
 * and the Options page are drawn by Firefox itself (`drawExtensionPage`), at 1.5 and 1.25 times
 * their size so their words stay readable. Each picture is reduced to 256 colours and checked:
 * 1280 by 800 pixels, under 100 kB, or the run writes none of them.
 *
 * Usage: `pnpm store:screenshots` (builds the end-to-end flavour first, `pnpm build:e2e`: the
 * fake pages are served from localhost, which only that build's content scripts match). About two
 * minutes. It starts Firefox like the end-to-end run, with the same environment variables
 * (`E2E_FIREFOX`, `E2E_HEADLESS=0`, `PULSE_SERVER`), and is no part of `pnpm check` or CI.
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Browser, Page } from 'puppeteer';
import sharp from 'sharp';
import { z } from 'zod';
import { expectEventually } from '../e2e/expect-eventually';
import {
  assertAudioWorks,
  currentRecordingId,
  DOWNLOAD_DIR,
  EXTENSION_DIR,
  FIREFOX,
  launch,
  openMeeting,
  PORT,
  pressCardButton,
  ROOT,
  selectAudioServer,
  sleep,
  storedRecording,
  waitFor,
  waitForExtensionReady,
  waitForNewRecording,
} from '../e2e/harness';
import { notesFor, waitForNotes } from '../e2e/notes-files';
import { startFixtureServer } from '../fixture-server';
import { drawExtensionPage, type ExtensionPicture } from './draw-extension-page';
import { dressCallForPictures } from './dress-call-for-pictures';
import { excerptNotes } from './excerpt-notes';
import { judgeStoreScreenshot } from './judge-store-screenshot';
import { quantisePng } from './quantise-png';
import { renderPopupOverCall } from './render-popup-over-call';
import { renderRecordingAndNotes } from './render-recording-and-notes';

const IMAGES_DIR = path.join(ROOT, 'docs/store/images');
const MEETING_URL = `http://localhost:${PORT}/abc-defg-hij`;
const VIEWPORT = { width: 1280, height: 800 };
const TITLE = 'Weekly product sync';
const GUEST = 'Guest Two';
/** How far into the first recording the card's picture is taken, and the card's Stop saves it. */
const CARD_PICTURE_AT_MS = 45_000;
const FIRST_RECORDING_MS = 60_000;
/** How long the second recording runs before the popup is drawn. */
const SECOND_RECORDING_MS = 20_000;
/** Where in the first recording the fourth picture's frame is. */
const FRAME_AT_S = 20;
/** How long a recording may take to start once someone else is in the call, or after Record. */
const RECORDING_MS = 30_000;

const POPUP: ExtensionPicture = {
  path: 'popup.html',
  // The meeting card of the call being recorded, and the saved recording's row.
  ready: `document.body.innerText.includes('Stop & save') && document.body.innerText.includes('Show file')`,
  frame: `JSON.stringify(document.querySelector('main').getBoundingClientRect())`,
  scale: 1.5,
};

const OPTIONS: ExtensionPicture = {
  path: 'options.html',
  // Every setting shows its value once the stored settings are read.
  ready: `(() => {
    const fields = [...document.querySelectorAll('[role="combobox"]')];
    return fields.length > 0 && fields.every((field) => field.textContent.trim() !== '');
  })()`,
  // The top of the page, 1280 by 800 once drawn at 1.25, centred on its column.
  frame: `(() => {
    const column = document.querySelector('main').getBoundingClientRect();
    return JSON.stringify({ x: column.x + column.width / 2 - 512, y: 0, width: 1024, height: 640 });
  })()`,
  scale: 1.25,
};

const toBuffer = (bytes: Uint8Array): Buffer => Buffer.from(bytes);
const dataUrl = (png: Buffer): string => `data:image/png;base64,${png.toString('base64')}`;

/** Joins the call on the dressed fake page, with the guest; the first recording starts by itself. */
async function joinCall(browser: Browser): Promise<{ page: Page; recordingId: string }> {
  const page = await openMeeting(browser, MEETING_URL);
  await page.setViewport(VIEWPORT);
  await dressCallForPictures(page);
  await page.evaluate(`window.__fixture.setTitle(${JSON.stringify(TITLE)})`);
  await page.evaluate('window.__fixture.start()');
  await waitFor(
    'the remote participant',
    () => page.evaluate('window.__fixture.participants().others.length > 0'),
    20_000,
  );
  await page.evaluate(
    `window.__fixture.addParticipant({ name: ${JSON.stringify(GUEST)}, camera: false })`,
  );
  const recordingId = await waitFor('a recording', () => currentRecordingId(page), RECORDING_MS);
  return { page, recordingId };
}

/** Clicks the status card's own toggle, which opens and closes its details. */
async function toggleCard(page: Page): Promise<void> {
  await page.evaluate(`window.__fixture.cardRoot().querySelector('.zr-toggle').click()`);
  // The card opens with a 160 ms animation.
  await sleep(500);
}

/** Picture 1: the card opened in the call. The card is closed again afterwards. */
async function pictureOfCard(page: Page): Promise<Buffer> {
  await toggleCard(page);
  const picture = toBuffer(await page.screenshot());
  await toggleCard(page);
  return picture;
}

/** Stops the recording from the card, and waits for its file, its notes and its saved status. */
async function stopAndSave(page: Page, recordingId: string): Promise<string> {
  await pressCardButton(page, 'Stop');
  // The run starts with an empty download folder, and this is its first recording.
  const webm = await waitForNewRecording(new Set());
  await waitForNotes(webm);
  await expectEventually(
    'the first recording saved',
    async () => (await storedRecording(page, recordingId))?.status,
    'saved',
  );
  return webm;
}

/** The overlay's toasts are gone: the "saved" one names the download folder's full path. */
async function waitForNoToasts(page: Page): Promise<void> {
  await waitFor(
    'no toast on the page',
    () =>
      page.evaluate(
        `window.__fixture.cardRoot().querySelector('.zr-toasts')?.childElementCount === 0`,
      ),
    20_000,
  );
}

/** A frame of `webm` at `atS` seconds, as PNG bytes. */
function frameOf(webm: string, atS: number): Buffer {
  return execFileSync(
    'ffmpeg',
    [
      '-v',
      'error',
      '-ss',
      String(atS),
      '-i',
      webm,
      '-frames:v',
      '1',
      '-c:v',
      'png',
      '-f',
      'image2pipe',
      'pipe:1',
    ],
    { maxBuffer: 64 * 1024 * 1024 },
  );
}

/** Shows `html` in a page of the picture's size and takes its screenshot. */
async function pictureOfPage(browser: Browser, html: string): Promise<Buffer> {
  const page = await browser.newPage();
  try {
    await page.setViewport(VIEWPORT);
    await page.setContent(html, { waitUntil: 'load' });
    return toBuffer(await page.screenshot());
  } finally {
    await page.close();
  }
}

/** Picture 4's page: the saved recording's folder, a frame of it and its notes. */
async function recordingAndNotesPage(webm: string): Promise<string> {
  const notes = notesFor(webm);
  const [recording, written] = await Promise.all([stat(webm), readFile(notes, 'utf8')]);
  const folder = path.relative(DOWNLOAD_DIR, path.dirname(webm)).split(path.sep);
  return renderRecordingAndNotes({
    // The run's download folder stands for the person's: the picture names no path of this machine.
    folder: ['Downloads', ...folder].join(' / '),
    recording: {
      name: path.basename(webm),
      bytes: recording.size,
      frame: dataUrl(frameOf(webm, FRAME_AT_S)),
    },
    notes: {
      name: path.basename(notes),
      bytes: Buffer.byteLength(written),
      excerpt: excerptNotes(written),
    },
  });
}

const pictureSizeSchema = z.object({ width: z.number(), height: z.number() });

/** Takes the four pictures, in the order of the listing, by their file names. */
async function takePictures(browser: Browser, extensionId: string): Promise<Map<string, Buffer>> {
  const { page, recordingId } = await joinCall(browser);
  const startedAt = Date.now();
  await sleep(CARD_PICTURE_AT_MS);
  const card = await pictureOfCard(page);
  await sleep(Math.max(0, FIRST_RECORDING_MS - (Date.now() - startedAt)));
  const webm = await stopAndSave(page, recordingId);
  await pressCardButton(page, 'Record');
  await waitFor('the second recording', () => currentRecordingId(page), RECORDING_MS);
  await sleep(SECOND_RECORDING_MS);
  await waitForNoToasts(page);
  const call = toBuffer(await page.screenshot());
  const popup = await drawExtensionPage(browser, extensionId, POPUP);
  const options = await drawExtensionPage(browser, extensionId, OPTIONS);
  const popupSize = pictureSizeSchema.parse(await sharp(popup).metadata());
  const popupOverCall = await pictureOfPage(
    browser,
    renderPopupOverCall({ call: dataUrl(call), popup: { src: dataUrl(popup), ...popupSize } }),
  );
  const recordingAndNotes = await pictureOfPage(browser, await recordingAndNotesPage(webm));
  return new Map([
    ['screenshot-1-status-card.png', card],
    ['screenshot-2-popup.png', popupOverCall],
    ['screenshot-3-options.png', options],
    ['screenshot-4-recording-and-notes.png', recordingAndNotes],
  ]);
}

/** Bytes of the committed picture, or null for a new one. */
const sizeOf = async (file: string): Promise<number | null> =>
  existsSync(file) ? (await stat(file)).size : null;

/** Reduces, checks and writes the pictures; writes none when one misses the listing's limits. */
async function writePictures(pictures: Map<string, Buffer>): Promise<void> {
  const reduced = await Promise.all(
    [...pictures].map(async ([name, png]) => ({ name, ...(await quantisePng(png)) })),
  );
  const problems = reduced.flatMap(({ name, png, width, height }) =>
    judgeStoreScreenshot({ width, height, bytes: png.length }).map(
      (problem) => `${name} ${problem}`,
    ),
  );
  if (problems.length > 0) throw new Error(`no screenshot written:\n${problems.join('\n')}`);
  for (const { name, png, width, height } of reduced) {
    const file = path.join(IMAGES_DIR, name);
    const was = await sizeOf(file);
    await writeFile(file, png);
    const before = was === null ? 'new' : `was ${was.toLocaleString('en-US')}`;
    console.log(
      `${name}: ${width} by ${height}, ${png.length.toLocaleString('en-US')} bytes (${before})`,
    );
  }
}

async function main(): Promise<void> {
  if (!existsSync(EXTENSION_DIR))
    throw new Error(`build first (pnpm build:e2e): ${EXTENSION_DIR} missing`);
  if (!existsSync(FIREFOX)) throw new Error(`run pnpm setup:firefox first: ${FIREFOX} missing`);
  // Firefox inherits it: the notes, the file names and the popup's dates name no local time zone.
  process.env['TZ'] = 'UTC';
  console.log(`audio server: ${selectAudioServer()}`);
  await rm(DOWNLOAD_DIR, { recursive: true, force: true });
  await mkdir(DOWNLOAD_DIR, { recursive: true });
  const server = await startFixtureServer(PORT);
  const browser = await launch({ prefs: { 'intl.locale.requested': 'en-US' } });
  try {
    const extensionId = await browser.installExtension(EXTENSION_DIR);
    await waitForExtensionReady(browser, MEETING_URL);
    await assertAudioWorks(browser, MEETING_URL);
    await writePictures(await takePictures(browser, extensionId));
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
