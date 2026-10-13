/**
 * E2e scenario 16, run against every provider's fixture page: the page stays busy for seconds, so
 * the audio reaches it late the whole time → no silence is inserted, and the file's audio is as
 * long as the recording.
 */
import path from 'node:path';
import type { Page } from 'puppeteer';
import { z } from 'zod';
import {
  describeWebm,
  ffprobe,
  inspectWebm,
  listWebm,
  openMeeting,
  pageDiagnostics,
  probe,
  silences,
  sleep,
  trackEnds,
  waitFor,
  waitForNewRecording,
} from './harness';
import type { ScenarioContext, ScenarioRegistration } from './order-scenarios';
import { meetingUrl } from './targets';

const videoModeSchema = z.object({ videoMode: z.string() });

/** Seconds of the file that hold the start-up, before the first busy spell. */
const STARTUP_S = 3;

/** How long the page stays busy in scenario 16: long enough for the old 2 s repair window, twice. */
const BACKLOG_MS = 8_000;

/** Each of the page's long tasks in scenario 16. */
const LONG_TASK_MS = 100;

/**
 * Keeps the page busy for `BACKLOG_MS` with back-to-back long tasks. They are scheduled through a
 * MessagePort, like the audio tap's buffers, so the two take turns: the page handles about one
 * buffer per long task, fewer than the tap posts, and the audio reaches it later and later.
 */
async function busyFor(page: Page): Promise<void> {
  await page.evaluate(
    (busyMs, taskMs) =>
      new Promise<void>((resolve) => {
        const channel = new MessageChannel();
        const end = performance.now() + busyMs;
        channel.port1.onmessage = () => {
          const taskEnd = performance.now() + taskMs;
          while (performance.now() < taskEnd) {
            // a long task: nothing else runs on the page meanwhile
          }
          if (performance.now() < end) channel.port2.postMessage(null);
          else resolve();
        };
        channel.port2.postMessage(null);
      }),
    BACKLOG_MS,
    LONG_TASK_MS,
  );
}

export async function scenarioSustainedBacklog({
  browser,
  target,
}: ScenarioContext): Promise<void> {
  console.log(
    `▶ ${target.id} scenario 16: the page stays busy for ${BACKLOG_MS / 1000} s → no silence inserted, the file as long as the recording`,
  );
  const before = new Set(await listWebm());
  const page = await openMeeting(browser, meetingUrl(target));
  const result = videoModeSchema.safeParse(await probe(page, 'settings:video-on'));
  if (!result.success || result.data.videoMode !== 'tiles') {
    throw new Error('could not switch video on through the debug probe');
  }
  await page.click('#start');
  const startedAt = await waitFor(
    'recording started',
    () => page.evaluate(() => window.__zenRecorderPage?.snapshot().recordingStartedAt),
    20_000,
  );
  await sleep(STARTUP_S * 1_000);
  await busyFor(page);
  // Idle again: the queued audio drains, then the recording goes on for a while.
  await sleep(5_000);
  const stoppedAt = await page.evaluate(() => {
    if (!window.__fixture.clickOverlay('Stop')) throw new Error('no Stop button');
    return Date.now();
  });
  const file = await waitForNewRecording(before);
  const expectedS = (stoppedAt - startedAt) / 1000;
  const ends = await trackEnds(file);
  const gaps = silences(file, 0.3);
  const audioLines = (await pageDiagnostics(page, startedAt)).filter(
    (line) =>
      line.includes('filled with') || line.includes('audio clock') || line.includes('audio starts'),
  );
  console.log(`  saved: ${path.basename(file)} → ${describeWebm(await inspectWebm(file))}`);
  console.log(`    ffprobe: ${ffprobe(file)}`);
  console.log(
    `  recorded ${expectedS.toFixed(2)} s (Stop - start); audio ends at ${ends.audioS?.toFixed(2)} s, video at ${ends.videoS?.toFixed(2)} s`,
  );
  console.log(`  silences ≥ 0.3 s: ${JSON.stringify(gaps)}`);
  for (const line of audioLines) console.log(`  diagnostics: ${line}`);
  await page.close();
  const problems: string[] = [];
  const repairs = audioLines.filter((line) => line.includes('filled with'));
  if (repairs.length > 0) problems.push(`silence inserted for late audio: ${repairs.join('; ')}`);
  if (ends.audioS === null || Math.abs(ends.audioS - expectedS) > 0.5) {
    problems.push(`the audio is ${ends.audioS} s long for a ${expectedS.toFixed(2)} s recording`);
  }
  const long = gaps.filter(([start]) => start > STARTUP_S);
  if (long.length > 0) problems.push(`silent stretches in the audio: ${JSON.stringify(long)}`);
  if (problems.length > 0) throw new Error(problems.join('; '));
}

export const registration = {
  name: '16',
  after: '60',
  scenario: scenarioSustainedBacklog,
} satisfies ScenarioRegistration;
