/**
 * E2e scenario 58, run against every provider's fixture page like the ones in `scenarios.ts`: the
 * keyboard shortcut (the manifest's `toggle-recording`, Alt+Shift+R) starts recording the meeting
 * tab in front, and a second press stops it and saves a file a player opens.
 *
 * The keys are pressed in the browser window (`pressShortcut`), because Firefox handles an
 * extension's shortcut there: Puppeteer's `page.keyboard` dispatches its keys inside the page and
 * never reaches it. From the window the shortcut goes through the background's
 * `commands.onCommand`, its `tabs.query` for the active tab and the page's command, as when the
 * person presses it.
 */
import { z } from 'zod';
import {
  builtManifest,
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
import { pressShortcut } from './press-shortcut';
import type { ScenarioContext } from './scenarios';
import { meetingUrl } from './targets';

const tabsSchema = z.object({ tabs: z.array(z.object({ tabId: z.number() })) });

export async function scenarioKeyboardShortcut({
  browser,
  target,
}: ScenarioContext): Promise<void> {
  const shortcut = builtManifest().commands['toggle-recording']?.suggested_key?.default;
  if (!shortcut) throw new Error('the built manifest has no toggle-recording shortcut');
  console.log(
    `▶ ${target.id} scenario 58: ${shortcut} in the meeting tab → recording starts; again → it stops and the file is saved`,
  );
  const before = new Set(await listWebm());
  const page = await openMeeting(browser, meetingUrl(target));
  await page.bringToFront();
  await waitFor(
    'the meeting tab connected',
    async () => tabsSchema.parse(await probe(page, 'background:state')).tabs.length > 0,
    15_000,
  );
  if ((await currentRecordingId(page)) !== null)
    throw new Error('already recording before the shortcut');

  await pressShortcut(browser, shortcut);
  const id = await waitFor(
    'the shortcut to start a recording',
    () => currentRecordingId(page),
    10_000,
  );
  console.log(`  ${shortcut}: recording ${id} started`);
  await sleep(3_000);

  await pressShortcut(browser, shortcut);
  await waitFor(
    'the shortcut to stop the recording',
    async () => (await currentRecordingId(page)) === null,
    10_000,
  );
  const file = await waitForNewRecording(before);
  const info = await inspectWebm(file);
  console.log(`  ${shortcut} again: stopped, saved ${describeWebm(info)}`);
  if (info.durationS < 2) {
    throw new Error(`the saved file lasts ${info.durationS.toFixed(1)} s, expected about 3 s`);
  }
  await page.close();
}
