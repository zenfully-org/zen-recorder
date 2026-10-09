/**
 * E2e scenario 78, run against every provider's fixture page like the ones in `scenarios.ts`: the
 * recorder's clock says where the recording is in its saved file, pauses left out, with video
 * (WebCodecs) and without (MediaRecorder).
 *
 * Meeting notes place every event by this clock, so a reader can seek to it. The wall clock cannot
 * do it: a pause is in the wall time and not in the file, and so are the seconds a cold audio
 * graph takes to start (1.5-1.8 s on CI's machines), which a MediaRecorder file leaves out.
 *
 *   - The page records, pauses for 3 s and goes on. Across the pause the clock must move by the
 *     wall time minus the pause, within 1 s, and right before Stop it (`debug().clock.mediaMs`)
 *     must be within 1 s of the saved file's length. Measured from the recording's start, the
 *     wall time would also hold a cold graph's late start.
 *   - The microphone is muted after the pause and unmuted where the clock says X: the microphone's
 *     tone must be missing from the file just before X and back just after it.
 */
import path from 'node:path';
import type { Page } from 'puppeteer';
import { z } from 'zod';
import {
  describeWebm,
  inspectWebm,
  listWebm,
  openMeeting,
  overlayState,
  probe,
  recordingStarted,
  recordingStartedAt,
  sleep,
  toneLevel,
  waitFor,
  waitForNewRecording,
} from './harness';
import type { ScenarioContext } from './scenarios';
import { type FixtureTarget, meetingUrl } from './targets';

/** The fixtures' fake microphone. */
const MIC_TONE_HZ = 1000;
const PAUSE_MS = 3_000;
/** How far the clock may be from the file's length, and its move across the pause from the wall's. */
const TOLERANCE_MS = 1_000;
const clockSchema = z.object({
  clock: z.object({ mediaMs: z.number(), paused: z.boolean() }).nullable(),
});

async function readClockMs(page: Page): Promise<number> {
  const debug = clockSchema.safeParse(await page.evaluate(() => window.__zenRecorderPage?.debug()));
  const clock = debug.success ? debug.data.clock : null;
  if (!clock) throw new Error('the page reports no clock while recording (debug().clock)');
  return clock.mediaMs;
}

async function press(page: Page, button: 'Pause' | 'Resume', state: string): Promise<void> {
  await page.evaluate((name) => window.__fixture.clickOverlay(name), button);
  await waitFor(state, async () => (await overlayState(page)) === state, 5_000);
}

/** Records with a pause and a mute; returns what the clock said and what the file holds. */
async function recordOnce(page: Page, before: ReadonlySet<string>, label: string): Promise<void> {
  await page.click('#start');
  await waitFor('recording', async () => (await overlayState(page)) === 'recording', 20_000);
  await waitFor('encoder started', () => recordingStarted(page), 20_000);
  const startedAt = await recordingStartedAt(page);
  await sleep(3_000);
  const beforePause = { clock: await readClockMs(page), wall: Date.now() };
  await press(page, 'Pause', 'paused');
  const pausedAt = Date.now();
  await sleep(PAUSE_MS);
  await press(page, 'Resume', 'recording');
  const pausedMs = Date.now() - pausedAt;
  const afterPause = { clock: await readClockMs(page), wall: Date.now() };
  // What the clock moved across the pause, less what the wall moved outside it.
  const pauseError =
    afterPause.clock - beforePause.clock - (afterPause.wall - beforePause.wall - pausedMs);
  await sleep(1_000);
  await page.evaluate(() => window.__fixture.mute());
  await sleep(2_000);
  const unmutedAtMs = await readClockMs(page);
  await page.evaluate(() => window.__fixture.unmute());
  await sleep(2_500);
  const clockMs = await readClockMs(page);
  const wallMs = Date.now() - startedAt;
  await page.evaluate(() => window.__fixture.clickOverlay('Stop'));
  const file = await waitForNewRecording(before);
  const info = await inspectWebm(file);
  const fileMs = info.durationS * 1000;
  console.log(`  ${label}: file ${path.basename(file)} → ${describeWebm(info)}`);
  console.log(
    `  ${label}: clock at stop ${clockMs.toFixed(0)} ms, file ${fileMs.toFixed(0)} ms (Δ ${(clockMs - fileMs).toFixed(0)}); wall ${wallMs} ms − clock = ${(wallMs - clockMs).toFixed(0)} ms, paused ${pausedMs} ms; across the pause the clock is ${pauseError.toFixed(0)} ms off the wall`,
  );
  const at = unmutedAtMs / 1000;
  const muted = toneLevel(file, MIC_TONE_HZ, at - 1.5, at - 0.5);
  const live = toneLevel(file, MIC_TONE_HZ, at + 0.5, at + 1.5);
  console.log(
    `  ${label}: microphone unmuted at ${at.toFixed(2)} s by the clock: ${muted.toFixed(1)} dBFS before, ${live.toFixed(1)} dBFS after`,
  );
  const problems = [
    ...(Math.abs(clockMs - fileMs) > TOLERANCE_MS ? ['the clock is not the file length'] : []),
    ...(Math.abs(pauseError) > TOLERANCE_MS ? ['the clock counts the pause'] : []),
    ...(muted < -50 && live > -40
      ? []
      : ['the microphone does not come back where the clock says']),
  ];
  if (problems.length > 0) throw new Error(`${label}: ${problems.join('; ')}`);
}

/** With video, then without (the setting switched off on the page for the time of the run). */
export async function scenarioMediaClock({ browser, target }: ScenarioContext): Promise<void> {
  console.log(`▶ ${target.id} scenario 78: the clock says where the recording is in its file`);
  await recordMode(browser, target, 'with video', false);
  await recordMode(browser, target, 'audio only', true);
}

async function recordMode(
  browser: ScenarioContext['browser'],
  target: FixtureTarget,
  label: string,
  videoOff: boolean,
): Promise<void> {
  const before = new Set(await listWebm());
  const page = await openMeeting(browser, meetingUrl(target));
  try {
    if (videoOff) await probe(page, 'settings:video-off');
    await recordOnce(page, before, label);
  } finally {
    if (videoOff) await probe(page, 'settings:video-on');
  }
  await page.close();
}
