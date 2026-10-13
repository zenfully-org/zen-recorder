/**
 * The start e2e scenarios 63 and 95 share: on a fixture page whose tiles a worker paints into a
 * canvas (Zoom), open the meeting and record its call with video, two tiles on screen. They then
 * keep that worker busy and watch what the canvas's snapshots do to the page. Null, with a line
 * saying so, on a page without such a worker.
 */
import type { Page } from 'puppeteer';
import { z } from 'zod';
import { currentRecordingId, listWebm, openMeeting, probe, sleep, waitFor } from './harness';
import type { ScenarioContext } from './order-scenarios';
import { meetingUrl } from './targets';

const videoModeSchema = z.object({ videoMode: z.literal('tiles') });

interface PaintedCall {
  page: Page;
  /** The recordings saved before this one. */
  before: ReadonlySet<string>;
  /** When the page was opened (epoch ms): its diagnostics lines start here. */
  opened: number;
}

export async function recordPaintedCall({
  browser,
  target,
}: ScenarioContext): Promise<PaintedCall | null> {
  const before = new Set(await listWebm());
  const page = await openMeeting(browser, meetingUrl(target));
  if (!(await page.evaluate(() => typeof window.__fixture.stallPainter === 'function'))) {
    console.log('  skipped: no worker paints this fixture page');
    await page.close();
    return null;
  }
  if (!videoModeSchema.safeParse(await probe(page, 'settings:video-on')).success) {
    throw new Error('could not switch video on through the debug probe');
  }
  const opened = Date.now();
  await page.click('#start');
  await waitFor('recording', () => currentRecordingId(page), 20_000);
  await waitFor(
    'two tiles',
    async () => (await page.evaluate(() => window.__fixture.tileCount())) >= 2,
    20_000,
  );
  await sleep(2_000);
  return { page, before, opened };
}
