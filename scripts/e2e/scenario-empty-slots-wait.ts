/**
 * E2e scenario 69, run against every provider's fixture page like the ones in `scenarios.ts`: a
 * call nobody else has joined does not start recording, even though its connection already holds
 * remote audio tracks.
 *
 * Meet connects every call with a few audio slots for the people who will speak, and their tracks
 * exist before anyone fills them. Firefox gives such a track no audio and keeps it `muted` until
 * its first packet arrives. The recorder starts once someone else is in the call, and on Meet that
 * means a remote track with audio in it.
 *
 *   - The page joins with its slots empty (`FixtureApi.emptySlots`): the remote side negotiates
 *     its audio and video and sends nothing. The recorder must keep waiting, longer than one pass
 *     of its periodic look at the connection's receivers.
 *   - The remote side then sends (`fillSlots`): the recorder starts, and the saved file carries
 *     the remote side's tone.
 *
 * Providers that count the participants themselves (Zoom, Teams) leave `emptySlots` out and skip.
 */
import path from 'node:path';
import type { Page } from 'puppeteer';
import {
  describeWebm,
  inspectWebm,
  listWebm,
  openMeeting,
  overlayState,
  sleep,
  toneLevel,
  waitFor,
  waitForNewRecording,
} from './harness';
import type { ScenarioContext } from './scenarios';
import { meetingUrl } from './targets';

/** The remote side's tone (`fake-peer.html`). */
const REMOTE_TONE_HZ = 440;
/** More than two passes of the hook's receiver rescan, which runs every 3 s. */
const EMPTY_FOR_MS = 7_000;
/** A tone the mixer passes sits around -20 dBFS; an empty band stays below -60. */
const TONE_FLOOR_DB = -40;

/** Every overlay state seen while the call stays empty for `ms`. */
async function statesWhileEmpty(page: Page, ms: number): Promise<Set<string>> {
  const seen = new Set<string>();
  for (const end = Date.now() + ms; Date.now() < end; await sleep(250)) {
    seen.add((await overlayState(page)) ?? 'none');
  }
  return seen;
}

export async function scenarioEmptySlotsWait({ browser, target }: ScenarioContext): Promise<void> {
  console.log(`▶ ${target.id} scenario 69: remote slots nobody fills do not start a recording`);
  const page = await openMeeting(browser, meetingUrl(target));
  const hasSlots = await page.evaluate(() => typeof window.__fixture.emptySlots === 'function');
  if (!hasSlots) {
    console.log(`  skipped: ${target.label} counts its participants itself`);
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
  const seen = await statesWhileEmpty(page, EMPTY_FOR_MS);
  console.log(`  status card while the slots are empty: ${[...seen].join(', ')}`);
  if (seen.has('recording')) {
    throw new Error(
      `with the remote slots empty the recorder started (status card: ${[...seen].join(', ')}), it must wait for someone to send audio`,
    );
  }
  await page.evaluate(() => window.__fixture.fillSlots?.());
  await waitFor('recording state', async () => (await overlayState(page)) === 'recording', 20_000);
  console.log('  recording started once the remote side sent audio');
  await sleep(5_000);
  await page.evaluate(() => window.__fixture.hangup());
  const file = await waitForNewRecording(before);
  const info = await inspectWebm(file);
  console.log(`  file: ${path.basename(file)} → ${describeWebm(info)}`);
  const level = toneLevel(file, REMOTE_TONE_HZ, 1, Math.max(2, info.durationS - 1));
  console.log(`  remote tone: ${level.toFixed(1)} dBFS`);
  if (!(level > TONE_FLOOR_DB)) {
    throw new Error(
      `the remote side's ${REMOTE_TONE_HZ} Hz tone is at ${level.toFixed(1)} dBFS in the file, expected above ${TONE_FLOOR_DB}`,
    );
  }
  await page.close();
}
