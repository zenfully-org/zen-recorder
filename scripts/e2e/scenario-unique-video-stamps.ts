/**
 * E2e scenario 46, run against every provider's fixture page like the ones in `scenarios.ts`: every
 * video frame of a saved file has a timestamp of its own, for a recording stopped with Stop and for
 * one saved as "(recovered)" after its tab died.
 *
 * The muxer rounds every video timestamp to the track's frame grid (1/15 s), and a frame is stamped
 * once it is drawn, so two frames less than a slot apart (a draw kept waiting by a busy page, then a
 * quick one) shared a timestamp: ffmpeg reports "non monotonically increasing dts" and a player may
 * drop or reorder one of them. The page here runs a long task every 170 ms, so draws wait at
 * changing points of the frame clock's 67 ms cycle.
 */
import path from 'node:path';
import type { Page } from 'puppeteer';
import { z } from 'zod';
import { readVideoTimeline } from '../bench/read-video-timeline';
import {
  currentRecordingId,
  describeWebm,
  inspectWebm,
  listWebm,
  openMeeting,
  probe,
  sleep,
  waitFor,
  waitForNewRecording,
} from './harness';
import { dieLikeACrash, type ScenarioContext } from './scenarios';
import { meetingUrl } from './targets';

const videoModeSchema = z.object({ videoMode: z.literal('tiles') });
const recordingsSchema = z.object({
  recordings: z.array(z.object({ id: z.string(), chunkCount: z.number() })),
});

/** How long each recording runs before it is stopped or its tab dies. */
const RECORDING_MS = 10_000;
/** The page's long task: 40 ms every 170 ms, out of step with the 67 ms frame clock. */
const BUSY_MS = 40;
const BUSY_EVERY_MS = 170;

export async function scenarioUniqueVideoStamps({
  browser,
  target,
}: ScenarioContext): Promise<void> {
  console.log(
    `▶ ${target.id} scenario 46: a page busy in bursts → every video frame of a stopped and of a recovered file has a timestamp of its own`,
  );
  const problems: string[] = [];

  let before = new Set(await listWebm());
  const stopped = await openBusyMeeting(browser, target);
  await stopped.click('#start');
  await waitFor('recording', () => currentRecordingId(stopped), 20_000);
  await sleep(RECORDING_MS);
  await stopped.evaluate(() => window.__fixture.clickOverlay('Stop'));
  problems.push(...(await judge('stopped', await waitForNewRecording(before))));
  await stopped.close();

  before = new Set(await listWebm());
  const crashed = await openBusyMeeting(browser, target);
  await crashed.click('#start');
  const id = await waitFor('recording', () => currentRecordingId(crashed), 20_000);
  await sleep(RECORDING_MS);
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
