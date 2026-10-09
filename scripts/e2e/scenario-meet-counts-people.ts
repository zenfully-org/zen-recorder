/**
 * E2e scenario 73, run against every provider's fixture page like the ones in `scenarios.ts`: on
 * Meet the recorder starts when someone else is in the call, as the page counts the people, not
 * when remote audio arrives.
 *
 * Meet connects its audio slots before anyone joins, and their tracks exist while nobody sends on
 * them. It sends audio only for the people speaking, so someone who joins muted sends nothing.
 *
 *   - The page joins with nobody else in the call and the remote slots connected but silent
 *     (`FixtureApi.emptySlots`): the recorder must keep waiting, longer than two passes of its
 *     look at the connection's receivers.
 *   - Someone joins muted, with the camera off (`joinMuted`): the people count goes up and nothing
 *     is sent. The recorder must start.
 *   - Their audio arrives later (`fillSlots`): the saved file is silent at their tone before that
 *     and carries it after, so the recording began before any of their audio.
 *
 * Providers whose fixtures leave `joinMuted` out (Zoom, Teams) skip it.
 */
import path from 'node:path';
import type { Page } from 'puppeteer';
import {
  describeWebm,
  inspectWebm,
  listWebm,
  openMeeting,
  overlayState,
  recordingStartedAt,
  sleep,
  toneLevel,
  waitFor,
  waitForNewRecording,
} from './harness';
import type { ScenarioContext } from './scenarios';
import { meetingUrl } from './targets';

/** The remote side's tone (`fake-peer.html`). */
const REMOTE_TONE_HZ = 440;
/** More than two passes of the WebRTC hook's receiver rescan, which runs every 3 s. */
const ALONE_FOR_MS = 7_000;
/** The page is read once a second; a join must start the recording within a few. */
const START_WITHIN_MS = 5_000;
/** The tone through the mixer sits around -15 dBFS; the band without it stays below -55. */
const TONE_FLOOR_DB = -40;
const QUIET_CEILING_DB = -55;

/** Every status the card shows while the user is alone for `ms`. */
async function statesWhileAlone(page: Page, ms: number): Promise<Set<string>> {
  const seen = new Set<string>();
  for (const end = Date.now() + ms; Date.now() < end; await sleep(250)) {
    seen.add((await overlayState(page)) ?? 'none');
  }
  return seen;
}

/** Fails unless the remote tone is absent before `fillS` in the file and present after it. */
function expectToneFrom(file: string, fillS: number, durationS: number): void {
  const before = toneLevel(file, REMOTE_TONE_HZ, 0.5, fillS - 0.5);
  const after = toneLevel(file, REMOTE_TONE_HZ, fillS + 1, Math.min(durationS, fillS + 3));
  console.log(
    `  remote tone: ${before.toFixed(1)} dBFS before their audio, ${after.toFixed(1)} dBFS after (it arrived at ${fillS.toFixed(1)} s)`,
  );
  if (!(before < QUIET_CEILING_DB && after > TONE_FLOOR_DB)) {
    throw new Error(
      `expected the recording to start before the remote audio (tone below ${QUIET_CEILING_DB} dBFS) and to carry it after (above ${TONE_FLOOR_DB}): got ${before.toFixed(1)} and ${after.toFixed(1)}`,
    );
  }
}

export async function scenarioMeetCountsPeople({
  browser,
  target,
}: ScenarioContext): Promise<void> {
  console.log(
    `▶ ${target.id} scenario 73: someone who joins muted starts the recording, nobody does not`,
  );
  const page = await openMeeting(browser, meetingUrl(target));
  if (!(await page.evaluate(() => typeof window.__fixture.joinMuted === 'function'))) {
    console.log(`  skipped: the ${target.label} fixture has no people count of its own to drive`);
    await page.close();
    return;
  }
  const before = new Set(await listWebm());
  await page.evaluate(() => window.__fixture.emptySlots?.());
  await page.click('#start');
  await waitFor(
    'the status card in the call',
    async () => ['waiting', 'recording'].includes((await overlayState(page)) ?? ''),
    20_000,
  );
  const alone = await statesWhileAlone(page, ALONE_FOR_MS);
  console.log(`  status card alone, the slots connected: ${[...alone].join(', ')}`);
  if (alone.has('recording')) {
    throw new Error(
      `alone in the call, the recorder started (status card: ${[...alone].join(', ')}); it must wait for someone else`,
    );
  }
  const joinedAt = Date.now();
  await page.evaluate(() => window.__fixture.joinMuted?.());
  await waitFor(
    'recording once someone joined muted',
    async () => (await overlayState(page)) === 'recording',
    START_WITHIN_MS,
  );
  console.log(
    `  recording ${((Date.now() - joinedAt) / 1000).toFixed(1)} s after someone joined muted`,
  );
  await sleep(3_000);
  const startedAt = await recordingStartedAt(page);
  const filledAt = Date.now();
  await page.evaluate(() => window.__fixture.fillSlots?.());
  await sleep(4_000);
  await page.evaluate(() => window.__fixture.hangup());
  const file = await waitForNewRecording(before);
  const info = await inspectWebm(file);
  console.log(`  file: ${path.basename(file)} → ${describeWebm(info)}`);
  expectToneFrom(file, (filledAt - startedAt) / 1000, info.durationS);
  await page.close();
}
