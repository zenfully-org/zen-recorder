/**
 * E2e scenario 46, run against every provider's fixture page like the ones in `scenarios.ts`: every
 * video frame of a saved file has a timestamp of its own, for a recording stopped with Stop and for
 * one saved as "(recovered)" after its tab died.
 *
 * The muxer rounds every video timestamp to the track's frame grid (1/15 s), and a frame is stamped
 * once it is drawn, so two frames less than a slot apart shared a timestamp: ffmpeg reports "non
 * monotonically increasing dts" and a player may drop or reorder one of them. Each recording here
 * is paused and resumed 30 times: the clock stands still while paused, so the first frame after
 * Resume comes right after the last one before Pause, about one time in seven within its slot.
 * The page also runs a long task every 170 ms, which keeps a draw that waits for a snapshot (a
 * canvas source) waiting at changing points of the frame clock's 67 ms cycle.
 */
import path from 'node:path';
import type { Page } from 'puppeteer';
import { z } from 'zod';
import { readVideoTimeline } from '../bench/read-video-timeline';
import { dieLikeACrash } from './die-like-a-crash';
import {
  currentRecordingId,
  describeWebm,
  inspectWebm,
  listWebm,
  openMeeting,
  overlayState,
  probe,
  sleep,
  waitFor,
  waitForNewRecording,
} from './harness';
import type { ScenarioContext } from './scenarios';
import { meetingUrl } from './targets';

const videoModeSchema = z.object({ videoMode: z.literal('tiles') });
const recordingsSchema = z.object({
  recordings: z.array(z.object({ id: z.string(), chunkCount: z.number() })),
});

/** Pause and Resume cycles per recording, each one a chance for two frames to meet in a slot. */
const PAUSES = 30;
/** The page's long task: 40 ms every 170 ms, out of step with the 67 ms frame clock. */
const BUSY_MS = 40;
const BUSY_EVERY_MS = 170;

export async function scenarioUniqueVideoStamps({
  browser,
  target,
}: ScenarioContext): Promise<void> {
  console.log(
    `▶ ${target.id} scenario 46: ${PAUSES} pauses on a page busy in bursts → every video frame of a stopped and of a recovered file has a timestamp of its own`,
  );
  const problems: string[] = [];

  let before = new Set(await listWebm());
  const stopped = await openBusyMeeting(browser, target);
  await stopped.click('#start');
  await waitFor('recording', () => currentRecordingId(stopped), 20_000);
  await pauseAndResume(stopped);
  await stopped.evaluate(() => window.__fixture.clickOverlay('Stop'));
  problems.push(...(await judge('stopped', await waitForNewRecording(before))));
  await stopped.close();

  before = new Set(await listWebm());
  const crashed = await openBusyMeeting(browser, target);
  await crashed.click('#start');
  const id = await waitFor('recording', () => currentRecordingId(crashed), 20_000);
  await pauseAndResume(crashed);
  // Two stored chunks at least, so that the recovered file holds more than the first one.
  await waitFor(
    'two chunks stored',
    async () =>
      (recordingsSchema
        .parse(await probe(crashed, 'background:state'))
        .recordings.find((recording) => recording.id === id)?.chunkCount ?? 0) > 1,
    20_000,
  );
  await dieLikeACrash(crashed);
  await crashed.close();
  const recovered = await waitForNewRecording(before, (file) => file.includes('(recovered)'));
  problems.push(...(await judge('recovered', recovered)));

  if (problems.length > 0) throw new Error(problems.join('; '));
}

/** A meeting page that records video and runs a long task every `BUSY_EVERY_MS`. */
async function openBusyMeeting(
  browser: ScenarioContext['browser'],
  target: ScenarioContext['target'],
): Promise<Page> {
  const page = await openMeeting(browser, meetingUrl(target));
  if (!videoModeSchema.safeParse(await probe(page, 'settings:video-on')).success) {
    throw new Error('could not switch video on through the debug probe');
  }
  await page.evaluate(
    (busyMs, everyMs) => {
      window.setInterval(() => {
        const end = performance.now() + busyMs;
        while (performance.now() < end) {
          // a long task: nothing else runs on the page meanwhile
        }
      }, everyMs);
    },
    BUSY_MS,
    BUSY_EVERY_MS,
  );
  return page;
}

/**
 * Records 2 s, then pauses and resumes `PAUSES` times, holding each state for a time that changes
 * from one cycle to the next, so that the pauses fall at every point of the frame clock's cycle.
 */
async function pauseAndResume(page: Page): Promise<void> {
  await sleep(2_000);
  for (let cycle = 0; cycle < PAUSES; cycle++) {
    await page.evaluate(() => window.__fixture.clickOverlay('Pause'));
    await waitFor('paused', async () => (await overlayState(page)) === 'paused', 10_000);
    await sleep(150 + ((cycle * 37) % 160));
    await page.evaluate(() => window.__fixture.clickOverlay('Resume'));
    await waitFor(
      'recording again',
      async () => (await overlayState(page)) === 'recording',
      10_000,
    );
    await sleep(250 + ((cycle * 53) % 170));
  }
}

/** What is wrong with the video timestamps of `file`: none when every frame has its own. */
async function judge(label: string, file: string): Promise<string[]> {
  const info = await inspectWebm(file);
  const { frames } = await readVideoTimeline(file, info.bytes);
  const repeated = frames.filter((frame, i) => i > 0 && frame.t <= (frames[i - 1]?.t ?? 0));
  console.log(`  ${label}: ${path.basename(file)} → ${describeWebm(info)}`);
  console.log(`    ${repeated.length} of ${frames.length} video frames repeat a timestamp`);
  if (frames.length < 50) return [`${label}: only ${frames.length} video frames`];
  if (repeated.length === 0) return [];
  const stamps = repeated.slice(0, 5).map((frame) => frame.t.toFixed(3));
  return [`${label}: ${repeated.length} video frames repeat a timestamp (${stamps.join(', ')}, …)`];
}
