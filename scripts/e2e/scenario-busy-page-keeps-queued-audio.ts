/**
 * E2e scenario 14, run against every provider's fixture page: the page is busy right before Pause
 * and right before Stop → the audio still queued for the page is kept: no gap after Resume, and the
 * file's audio reaches the Stop.
 */
import path from 'node:path';
import type { Page } from 'puppeteer';
import { z } from 'zod';
import {
  describeWebm,
  ffprobe,
  inspectWebm,
  listWebm,
  meanVolume,
  openMeeting,
  overlayState,
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

/** How long the page is kept busy right before Pause and right before Stop. */
const BUSY_MS = 2_500;

/** Seconds of the file that hold the start-up, before the first busy spell. */
const STARTUP_S = 3;

/**
 * Keeps the page's main thread busy for `BUSY_MS`, then clicks an overlay button in the same task,
 * as a heavy meeting page would: what the audio thread posted meanwhile is still queued for the
 * page when the click is handled. Returns the time of the click.
 */
async function busyThenClick(page: Page, button: string): Promise<number> {
  return page.evaluate(
    (name, busyMs) => {
      const end = performance.now() + busyMs;
      while (performance.now() < end) {
        // a long task: nothing else runs on the page meanwhile
      }
      if (!window.__fixture.clickOverlay(name)) throw new Error(`no ${name} button`);
      return Date.now();
    },
    button,
    BUSY_MS,
  );
}

export async function scenarioBusyPageKeepsQueuedAudio({
  browser,
  target,
}: ScenarioContext): Promise<void> {
  console.log(
    `▶ ${target.id} scenario 14: a busy page right before Pause and Stop → its queued audio is kept`,
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
  await sleep(4_000);
  const pausedAt = await busyThenClick(page, 'Pause');
  await waitFor('paused', async () => (await overlayState(page)) === 'paused', 10_000);
  await sleep(3_000);
  const resumedAt = await page.evaluate(() => {
    if (!window.__fixture.clickOverlay('Resume')) throw new Error('no Resume button');
    return Date.now();
  });
  // Longer than the 2 s window of the audio clock repair: a pre-pause loss would be filled here.
  await sleep(4_000);
  const stoppedAt = await busyThenClick(page, 'Stop');
  const file = await waitForNewRecording(before);
  const expectedS = (stoppedAt - startedAt - (resumedAt - pausedAt)) / 1000;
  const ends = await trackEnds(file);
  const gaps = silences(file, 0.3);
  const lastSecond = meanVolume(file, expectedS - 1, expectedS);
  const repairs = (await pageDiagnostics(page)).filter((line) => line.includes('filled with'));
  console.log(`  saved: ${path.basename(file)} → ${describeWebm(await inspectWebm(file))}`);
  console.log(`    ffprobe: ${ffprobe(file)}`);
  console.log(
    `  recorded ${expectedS.toFixed(2)} s (Stop - start - pause); audio ends at ${ends.audioS?.toFixed(2)} s, video at ${ends.videoS?.toFixed(2)} s`,
  );
  console.log(`  silences ≥ 0.3 s: ${JSON.stringify(gaps)}`);
  console.log(
    `  last second before Stop: ${lastSecond === null ? 'no audio' : `${lastSecond} dB`}`,
  );
  for (const line of repairs) console.log(`  diagnostics: ${line}`);
  await page.close();
  if (ends.audioS === null || ends.audioS < expectedS - 0.5) {
    throw new Error(
      `the audio ends at ${ends.audioS} s, before the Stop at ${expectedS.toFixed(2)} s`,
    );
  }
  if (lastSecond === null || lastSecond < -50) {
    throw new Error(`the last second before Stop is silent (${lastSecond} dB)`);
  }
  // A start-up gap (the tap attaching while the page is busy starting) is not what this guards.
  const long = gaps.filter(([start, duration]) => start > STARTUP_S && duration >= 1);
  if (long.length > 0) {
    throw new Error(
      `silent stretches in the audio: ${JSON.stringify(long)} (lost before the Pause)`,
    );
  }
}

export const registration = {
  name: '14',
  after: '13',
  scenario: scenarioBusyPageKeepsQueuedAudio,
} satisfies ScenarioRegistration;
