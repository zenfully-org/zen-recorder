/**
 * E2e scenario 43, run against every provider's fixture page like the ones in `scenarios.ts`: a
 * recording stops while the extension takes no chunk (its chunks still wait in the page), then the
 * extension restarts and its recovery pass runs while the outage lasts → the page still claims the
 * stopped recording, the pass leaves it alone, and once the extension takes chunks again it is
 * saved whole under its own name, not as "(recovered)" without the chunks the page still held.
 */
import path from 'node:path';
import type { Page } from 'puppeteer';
import { z } from 'zod';
import {
  backgroundDiagnostics,
  currentRecordingId,
  describeWebm,
  EXTENSION_DIR,
  expectEqual,
  ffprobe,
  inspectWebm,
  listWebm,
  newRecordings,
  openMeeting,
  probe,
  sleep,
  waitFor,
  waitForCompleteFile,
} from './harness';
import type { ScenarioContext } from './scenarios';
import { meetingUrl } from './targets';

const videoModeSchema = z.object({ videoMode: z.string() });
const backgroundSchema = z.object({
  tabs: z.array(
    z.object({
      snapshot: z.object({
        recordingId: z.string().nullable(),
        // Absent from builds before the page claimed its stopped recordings.
        pendingRecordingIds: z.array(z.string()).optional(),
      }),
    }),
  ),
  recordings: z.array(
    z.object({ id: z.string(), status: z.string(), chunkCount: z.number(), byteSize: z.number() }),
  ),
});
const background = async (page: Page) =>
  backgroundSchema.parse(await probe(page, 'background:state'));
const storedRecording = async (page: Page, id: string) =>
  (await background(page)).recordings.find((recording) => recording.id === id);

/**
 * How long the store is held before the extension restarts: a recording that stored nothing for
 * 60 s is stale to the recovery pass, which runs 30 s after the background starts.
 */
const HOLD_BEFORE_RELOAD_MS = 33_000;
/** The recovery alarm fires 30 s after the background starts; wait past it. */
const AFTER_RELOAD_MS = 40_000;

/**
 * Audio only, and every MediaRecorder the page starts counted: how many non-empty chunks each one
 * handed over, which is how many the recorder sends of that recording.
 */
async function startCountedAudio(page: Page): Promise<string> {
  const result = videoModeSchema.safeParse(await probe(page, 'settings:video-off'));
  if (!result.success || result.data.videoMode !== 'off') {
    throw new Error('could not switch video off through the debug probe');
  }
  await page.evaluate(() => {
    const counts: number[] = [];
    const recorders: MediaRecorder[] = [];
    const start = MediaRecorder.prototype.start;
    MediaRecorder.prototype.start = function (this: MediaRecorder, timeslice?: number) {
      const index = recorders.push(this) - 1;
      counts[index] = 0;
      this.addEventListener('dataavailable', (event) => {
        if (event.data.size > 0) counts[index] = (counts[index] ?? 0) + 1;
      });
      start.call(this, timeslice);
    };
    window.__e2eRecorders = recorders;
    Object.assign(window, { __e2eChunkCounts: counts });
  });
  await page.click('#start');
  const first = await waitFor('first recording', () => currentRecordingId(page), 20_000);
  await waitFor(
    'the first chunk stored',
    async () => (await storedRecording(page, first))?.chunkCount,
    15_000,
  );
  return first;
}

/** The chunks the first MediaRecorder handed over, once it stopped. */
const firstRecorderChunks = (page: Page): Promise<number> =>
  page.evaluate(() => {
    const counts: unknown = Reflect.get(window, '__e2eChunkCounts');
    return Array.isArray(counts) && typeof counts[0] === 'number' ? counts[0] : -1;
  });

/** Makes the running MediaRecorder fail, as a broken encoder does; returns the next recording. */
async function failRecorder(page: Page, first: string): Promise<string> {
  await page.evaluate(() => {
    const recorder = window.__e2eRecorders?.at(-1);
    if (!recorder) throw new Error('no MediaRecorder was started');
    recorder.dispatchEvent(
      Object.assign(new Event('error'), { error: new Error('injected by the e2e run') }),
    );
  });
  return waitFor(
    'the next recording while the store holds',
    async () => {
      const id = await currentRecordingId(page);
      return id !== null && id !== first ? id : null;
    },
    10_000,
  );
}

/**
 * Restarts the extension while the store holds, holds the fresh background's store at once (the
 * page's chunk on its way to the old one times out first), and waits past its recovery pass.
 * Returns the page that reaches the fresh background, and what the pass left of the recording.
 */
async function restartDuringOutage(
  browser: ScenarioContext['browser'],
  url: string,
  first: string,
): Promise<{ control: Page; claimedBy: string; statusAfterPass: string }> {
  await browser.installExtension(EXTENSION_DIR);
  const reloadedAt = Date.now();
  // Not joined, so it records nothing: it reaches the fresh background.
  const control = await openMeeting(browser, url);
  console.log(
    `  hold the fresh store: ${JSON.stringify(await probe(control, 'store:hold-next-chunk'))}, ${((Date.now() - reloadedAt) / 1000).toFixed(1)} s after the restart`,
  );
  const claim = await waitFor(
    'the meeting tab in the fresh background',
    async () => {
      const tab = (await background(control)).tabs.find(
        ({ snapshot }) => snapshot.recordingId !== null,
      );
      return tab?.snapshot;
    },
    20_000,
  );
  const claimedBy = claim.pendingRecordingIds?.includes(first)
    ? 'the tab claims it as a stopped recording'
    : 'no tab claims it';
  console.log(`  ${first} in the fresh background: ${claimedBy} (${JSON.stringify(claim)})`);
  await sleep(Math.max(0, reloadedAt + AFTER_RELOAD_MS - Date.now()));
  const statusAfterPass = (await storedRecording(control, first))?.status ?? 'not stored';
  console.log(`  after the recovery pass: ${first} is ${statusAfterPass}`);
  return { control, claimedBy, statusAfterPass };
}

/** Once the store is released: the recording saved, the hangup, and the files saved since. */
async function saveAfterRelease(page: Page, control: Page, first: string, before: Set<string>) {
  console.log(
    `  release the store: ${JSON.stringify(await probe(control, 'store:release-chunks'))}`,
  );
  await waitFor(
    `${first} saved`,
    async () => (await storedRecording(control, first))?.status === 'saved',
    60_000,
  );
  await sleep(4_000);
  await page.evaluate(() => window.__fixture.hangup());
  const files = await waitFor(
    'two saved files',
    async () => {
      const saved = await newRecordings(before);
      return saved.length >= 2 ? saved : null;
    },
    60_000,
  );
  for (const file of files) {
    const info = await inspectWebm(await waitForCompleteFile(file));
    console.log(`  file: ${path.basename(file)} → ${describeWebm(info)}`);
    console.log(`    ffprobe: ${ffprobe(file)}`);
  }
  return files;
}

export async function scenarioRecoveryWhileDraining({
  browser,
  target,
}: ScenarioContext): Promise<void> {
  console.log(
    `▶ ${target.id} scenario 43: a recording stops while the extension takes no chunk, then the extension restarts → its recovery pass spares the stopped recording, saved whole later`,
  );
  const before = new Set(await listWebm());
  const url = meetingUrl(target);
  const page = await openMeeting(browser, url);
  const first = await startCountedAudio(page);
  // The store stops answering: the tab's chunks wait in the page, as they do on a full disk.
  console.log(`  hold the store: ${JSON.stringify(await probe(page, 'store:hold-next-chunk'))}`);
  const heldAt = Date.now();
  await sleep(4_000);
  const next = await failRecorder(page, first);
  const sent = await firstRecorderChunks(page);
  console.log(`  ${first} stopped after ${sent} chunks; ${next} records beside its chunks`);
  await sleep(Math.max(0, heldAt + HOLD_BEFORE_RELOAD_MS - Date.now()));
  const { control, claimedBy, statusAfterPass } = await restartDuringOutage(browser, url, first);
  try {
    const files = await saveAfterRelease(page, control, first, before);
    const dropped = (await backgroundDiagnostics(control)).filter(
      (line) => line.includes(first) && /dropping chunk|could not/.test(line),
    );
    for (const line of dropped) console.log(`  diagnostics: ${line}`);
    const stored = (await storedRecording(control, first))?.chunkCount;
    console.log(`  ${first}: ${stored} chunks in its file, the page sent ${sent}`);
    expectEqual(statusAfterPass, 'recording', `${first} after the recovery pass`);
    expectEqual(stored, sent, `chunks in the file of ${first}`);
    if (dropped.length > 0) throw new Error(`chunks of ${first} were dropped: ${dropped[0]}`);
    const recovered = files.filter((file) => file.includes('(recovered)'));
    if (recovered.length > 0)
      throw new Error(`saved as recovered: ${path.basename(recovered[0] ?? '')}`);
    if (claimedBy !== 'the tab claims it as a stopped recording') {
      throw new Error(`the fresh background did not know that the page still holds ${first}`);
    }
  } finally {
    await probe(control, 'store:release-chunks');
    await probe(control, 'settings:video-on');
  }
  await control.close();
  await page.close();
}
