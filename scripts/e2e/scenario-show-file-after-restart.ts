/**
 * E2e scenario 49, run against every provider's fixture page like the ones in `scenarios.ts`: Show
 * file acts on the recording's own file after the browser restarts, or says why it cannot.
 *
 * Firefox numbers the downloads of the extension API anew in every browser session, and a desktop
 * Firefox keeps no finished download in that list across a restart (Gecko's `ext-downloads.js`
 * `DownloadMap` and `DownloadIntegration.shouldPersistDownload`; bug 1247794). The id a recording
 * was saved under then names whatever the next session downloaded under that number, or nothing.
 *
 * The scenario runs a browser of its own on a profile it keeps: it records and saves, presses Show
 * file in that session (the recording's own file), restarts the browser on the same profile, saves
 * another file, which takes the recording's old id, and presses Show file again. That must not
 * reveal the other file: the browser no longer lists the recording's, so it opens the download
 * folder and says why, with the path the file was saved under. A test build notes what Show file
 * revealed instead of opening a file manager (the `downloads:revealed` probe).
 */
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { Browser } from 'puppeteer';
import { z } from 'zod';
import {
  currentRecordingId,
  EXTENSION_DIR,
  launch,
  listWebm,
  openMeeting,
  probe,
  sleep,
  waitFor,
  waitForExtensionReady,
  waitForNewRecording,
} from './harness';
import { NOT_LISTED } from './scenario-popup-show-file';
import type { ScenarioContext } from './scenarios';
import { type FixtureTarget, meetingUrl } from './targets';

const recordingsSchema = z.object({
  recordings: z.array(z.object({ id: z.string(), status: z.string() })),
});
const listSchema = z.object({
  downloads: z.array(z.object({ id: z.number(), filename: z.string(), state: z.string() })),
});
const otherSchema = z.object({ id: z.number(), filename: z.string() });
const rowSchema = z.object({ buttons: z.array(z.string()), failure: z.string() });
const revealedSchema = z.object({ revealed: z.array(z.string()) });

/** Stands for the download folder in what the test build's Show file revealed. */
const DOWNLOAD_FOLDER = '(the download folder)';

type Listed = z.infer<typeof listSchema>['downloads'];

const describeList = (downloads: Listed): string =>
  downloads.length === 0
    ? '(empty)'
    : downloads.map((item) => `${item.id} ${path.basename(item.filename)}`).join(', ');

/** Records a few seconds, stops, and waits until the recording is saved; returns its file. */
async function recordAndSave(browser: Browser, target: FixtureTarget) {
  const before = new Set(await listWebm());
  const page = await openMeeting(browser, meetingUrl(target));
  await page.click('#start');
  const id = await waitFor('recording', () => currentRecordingId(page), 20_000);
  await sleep(3_000);
  await page.evaluate(() => window.__fixture.clickOverlay('Stop'));
  const file = await waitForNewRecording(before);
  await waitFor(
    'the recording saved',
    async () => {
      const { recordings } = recordingsSchema.parse(await probe(page, 'background:state'));
      return recordings.find((recording) => recording.id === id)?.status === 'saved';
    },
    20_000,
  );
  return { page, file };
}

async function pressShowFile(page: Awaited<ReturnType<typeof openMeeting>>) {
  const answer = await probe(page, 'popup:show-file');
  const row = rowSchema.safeParse(answer);
  if (!row.success) throw new Error(`popup:show-file probe: ${JSON.stringify(answer)}`);
  const { revealed } = revealedSchema.parse(await probe(page, 'downloads:revealed'));
  return { failure: row.data.failure, revealed: revealed.join(', ') };
}

/**
 * Starts the browser on `profileDir`, waits until the extension reads its storage from a page at
 * `url`, runs `session` and closes the browser again.
 */
async function inSession<T>(
  profileDir: string,
  url: string,
  session: (browser: Browser) => Promise<T>,
) {
  const browser = await launch({ profileDir });
  try {
    await browser.installExtension(EXTENSION_DIR);
    await waitForExtensionReady(browser, url);
    return await session(browser);
  } finally {
    await browser.close();
  }
}

/** Saves a recording and presses its Show file; returns the path it was saved under. */
async function firstSession(browser: Browser, target: FixtureTarget, problems: string[]) {
  const { page, file } = await recordAndSave(browser, target);
  const { downloads } = listSchema.parse(await probe(page, 'downloads:list'));
  console.log(`  first session, the download list: ${describeList(downloads)}`);
  const own = downloads.find((item) => path.basename(item.filename) === path.basename(file));
  if (!own) throw new Error(`the download list does not hold ${file}`);
  const { failure, revealed } = await pressShowFile(page);
  console.log(`  Show file revealed ${revealed || 'nothing'}`);
  if (failure !== '' || revealed !== own.filename) {
    problems.push(
      `before the restart Show file revealed ${revealed || 'nothing'} (${failure || 'no failure'}), expected ${own.filename}`,
    );
  }
  return own.filename;
}

/** Saves another file, which takes the recording's old id, and presses Show file. */
async function afterRestart(
  browser: Browser,
  target: FixtureTarget,
  savedAs: string,
  problems: string[],
) {
  const page = await openMeeting(browser, meetingUrl(target));
  const listed = listSchema.parse(await probe(page, 'downloads:list')).downloads;
  console.log(`  after the restart, the download list: ${describeList(listed)}`);
  const other = otherSchema.parse(await probe(page, 'downloads:save-other'));
  console.log(`  another file saved as download ${other.id}: ${path.basename(other.filename)}`);
  const { failure, revealed } = await pressShowFile(page);
  console.log(`  Show file revealed ${revealed || 'nothing'}`);
  console.log(`  the row says: ${failure === '' ? '(nothing)' : failure}`);
  // A desktop Firefox lists no finished download after a restart; if it did, Show file shows it.
  const stillListed = listed.some((item) => item.filename === savedAs);
  const expected = stillListed
    ? { revealed: savedAs, failure: '' }
    : { revealed: DOWNLOAD_FOLDER, failure: `${NOT_LISTED}${savedAs}` };
  if (revealed !== expected.revealed) {
    problems.push(
      `after the restart Show file revealed ${revealed || 'nothing'}, expected ${expected.revealed}`,
    );
  }
  if (failure !== expected.failure) {
    problems.push(
      `after the restart the row said ${failure || 'nothing'}, expected ${expected.failure || 'nothing'}`,
    );
  }
  await page.close();
}

export async function scenarioShowFileAfterRestart({ target }: ScenarioContext): Promise<void> {
  console.log(
    `▶ ${target.id} scenario 49: Show file after a browser restart → the recording's own file or why not, never another download`,
  );
  const profileDir = await mkdtemp(path.join(os.tmpdir(), 'zen-recorder-e2e-profile-'));
  const problems: string[] = [];
  try {
    const savedAs = await inSession(profileDir, meetingUrl(target), (browser) =>
      firstSession(browser, target, problems),
    );
    await inSession(profileDir, meetingUrl(target), (browser) =>
      afterRestart(browser, target, savedAs, problems),
    );
  } finally {
    await rm(profileDir, { recursive: true, force: true });
  }
  if (problems.length > 0) throw new Error(problems.join('; '));
}
