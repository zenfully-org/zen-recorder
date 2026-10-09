/**
 * E2e scenario 70, run against every provider's fixture page like the ones in `scenarios.ts`: two
 * meeting tabs are open and one records → what the background tells about that recording shows in
 * that tab only, also once it stopped and is idle like the other one:
 *   - its file is saved: "Recording saved" shows in the recording tab, and not in the idle tab;
 *   - its next recording's save fails (a download Firefox interrupts): the error shows in the
 *     recording tab, and not in the idle tab.
 *
 * Every check is made and reported before the scenario fails, so one run of an older build shows
 * each thing it gets wrong.
 */
import path from 'node:path';
import type { Page } from 'puppeteer';
import { z } from 'zod';
import {
  currentRecordingId,
  listWebm,
  openMeeting,
  probe,
  sleep,
  toastsOf,
  waitFor,
  waitForNewRecording,
  watchToasts,
} from './harness';
import type { ScenarioContext } from './scenarios';
import { meetingUrl } from './targets';

const recordingsSchema = z.object({
  recordings: z.array(z.object({ id: z.string(), status: z.string() })),
});
const armedSchema = z.object({ armed: z.literal(true) });

/** What the test build's failing save says, in the error it reports. */
const SAVE_FAILED = 'FILE_FAILED';
/** The background posts to every tab it tells at once: by then, a toast for the idle tab shows. */
const SETTLE_MS = 2_000;

const statusOf = async (page: Page, id: string): Promise<string | undefined> =>
  recordingsSchema
    .parse(await probe(page, 'background:state'))
    .recordings.find((recording) => recording.id === id)?.status;

/** Records a few seconds and stops; resolves with the recording's id once it is saved or failed. */
async function recordAndStop(page: Page, previous: string | null): Promise<string> {
  const id = await waitFor(
    'a new recording',
    async () => {
      const current = await currentRecordingId(page);
      return current !== previous ? current : null;
    },
    20_000,
  );
  await sleep(4_000);
  await page.evaluate(() => window.__fixture.clickOverlay('Stop'));
  const status = await waitFor(
    `${id} saved or failed`,
    async () => {
      const current = await statusOf(page, id);
      return current === 'saved' || current === 'failed' ? current : null;
    },
    60_000,
  );
  console.log(`  ${id}: ${status}`);
  return id;
}

/** Waits for a toast in `page` whose text holds `words`; resolves with whether it showed. */
const toastShows = (page: Page, kind: string, words: string): Promise<boolean> =>
  waitFor(
    `a toast saying ${words}`,
    async () =>
      (await toastsOf(page)).some((toast) => toast.kind === kind && toast.text.includes(words)),
    10_000,
  ).catch(() => false);

export async function scenarioToastsInOwnTab({ browser, target }: ScenarioContext): Promise<void> {
  console.log(
    `▶ ${target.id} scenario 70: two meeting tabs, one records → its saved and its error toasts show in that tab only`,
  );
  const before = new Set(await listWebm());
  // The idle tab first: the recording tab must be in front (Firefox defers device lists in a
  // background tab).
  const idle = await openMeeting(browser, meetingUrl(target));
  const page = await openMeeting(browser, meetingUrl(target));
  await watchToasts(idle);
  await watchToasts(page);
  const problems: string[] = [];

  await page.click('#start');
  const saved = await recordAndStop(page, null);
  const file = path.basename(await waitForNewRecording(before));
  if (!(await toastShows(page, 'ok', file))) {
    problems.push(`the recording tab showed no "Recording saved" toast for ${file}`);
  }

  armedSchema.parse(await probe(page, 'save:fail-next'));
  await page.evaluate(() => window.__fixture.clickOverlay('Record'));
  const failed = await recordAndStop(page, saved);
  if ((await statusOf(page, failed)) !== 'failed')
    problems.push(`${failed}: its save did not fail`);
  if (!(await toastShows(page, 'error', SAVE_FAILED))) {
    problems.push('the recording tab showed no error toast for the failed save');
  }

  await sleep(SETTLE_MS);
  for (const [name, tab] of [
    ['recording tab', page],
    ['idle tab', idle],
  ] as const) {
    for (const toast of await toastsOf(tab))
      console.log(`  ${name} toast (${toast.kind}): ${toast.text}`);
  }
  for (const toast of await toastsOf(idle)) {
    problems.push(`the idle tab showed a toast about a recording of the other tab: ${toast.text}`);
  }
  await page.close();
  await idle.close();
  if (problems.length > 0) throw new Error(problems.join('; '));
}
