/**
 * E2e scenario 4, run against every provider's fixture page: video switched off → an audio-only
 * file.
 */
import path from 'node:path';
import { z } from 'zod';
import {
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
import type { ScenarioContext, ScenarioRegistration } from './order-scenarios';
import { meetingUrl } from './targets';

const videoModeSchema = z.object({ videoMode: z.string() });

export async function scenarioAudioOnly({ browser, target }: ScenarioContext): Promise<void> {
  console.log(`▶ ${target.id} scenario 4: video switched off → audio-only file`);
  const before = new Set(await listWebm());
  const page = await openMeeting(browser, meetingUrl(target));
  try {
    const result = videoModeSchema.safeParse(await probe(page, 'settings:video-off'));
    if (!result.success || result.data.videoMode !== 'off') {
      throw new Error('could not switch video off through the debug probe');
    }
    await page.click('#start');
    await waitFor(
      'recording state',
      async () => (await overlayState(page)) === 'recording',
      20_000,
    );
    await sleep(6_000);
    await page.evaluate(() => window.__fixture.hangup());
    const file = await waitForNewRecording(before);
    const info = await inspectWebm(file);
    console.log(`  saved: ${path.basename(file)} → ${describeWebm(info)}`);
    if (info.tracks !== 1 || info.video) throw new Error('expected an audio-only file');
  } finally {
    await probe(page, 'settings:video-on');
  }
  await page.close();
}

export const registration = {
  name: '4',
  after: '91',
  scenario: scenarioAudioOnly,
} satisfies ScenarioRegistration;
