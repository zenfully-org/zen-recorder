/**
 * E2e scenario 3, run against every provider's fixture page: the Record button while alone, then
 * join, then stop → one file that covers the time alone too.
 */
import path from 'node:path';
import {
  describeWebm,
  expectEqual,
  inspectWebm,
  listWebm,
  openMeeting,
  overlayState,
  pressCardButton,
  sleep,
  waitFor,
  waitForNewRecording,
} from './harness';
import type { ScenarioContext, ScenarioRegistration } from './order-scenarios';
import { meetingUrl } from './targets';

export async function scenarioRecordAlone({ browser, target }: ScenarioContext): Promise<void> {
  console.log(`▶ ${target.id} scenario 3: Record button while alone (no call yet), join, stop`);
  const before = new Set(await listWebm());
  const page = await openMeeting(browser, meetingUrl(target));
  expectEqual(await overlayState(page), 'idle', 'state before anything happens');
  await pressCardButton(page, 'Record');
  await waitFor('recording alone', async () => (await overlayState(page)) === 'recording', 10_000);
  await sleep(6_000);
  expectEqual(await overlayState(page), 'recording', 'state while alone after 6 s');
  await page.click('#start');
  await sleep(4_000);
  expectEqual(await overlayState(page), 'recording', 'state after joining');
  await pressCardButton(page, 'Stop');
  const file = await waitForNewRecording(before);
  const info = await inspectWebm(file);
  console.log(`  saved: ${path.basename(file)} → ${describeWebm(info)}`);
  // 6 s alone + 4 s in the call; Record is clicked right after page load, so the start may wait
  // up to 2 s for the encoder probe. The time alone has no audio source at all: the file must
  // still cover it (the mixer's keep-alive source and the audio clock repair guarantee that).
  if (!(info.durationS > 7.5)) throw new Error(`alone recording too short: ${info.durationS}`);
  await page.close();
}

export const registration = {
  name: '3',
  after: '86',
  scenario: scenarioRecordAlone,
} satisfies ScenarioRegistration;
