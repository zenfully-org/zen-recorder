/**
 * Scenario 84: a meeting page that records looks inside the status card → the card's shadow root
 * is closed, so the page reads nothing of what the card shows. The card says whether the tab
 * records, for how long, how many video tiles and what went wrong; through an open root, a script
 * of the page could follow every Record, Pause and Stop. A test build hands the root to the fake
 * page (`window.__zenRecorderCard`, read by `cardRoot()`), which is how the end-to-end run reads
 * and clicks the card; this scenario checks the page's own way in, the host's `shadowRoot`.
 */
import path from 'node:path';
import {
  describeWebm,
  inspectWebm,
  listWebm,
  openMeeting,
  overlayState,
  waitFor,
  waitForNewRecording,
} from './harness';
import type { ScenarioContext } from './scenarios';
import { meetingUrl } from './targets';

export async function scenarioCardClosedToPage({
  browser,
  target,
}: ScenarioContext): Promise<void> {
  console.log(
    `▶ ${target.id} scenario 84: a recording page looks inside the status card → its shadow root is closed, the page reads none of it`,
  );
  const before = new Set(await listWebm());
  const page = await openMeeting(browser, meetingUrl(target));
  await page.click('#start');
  await waitFor(
    'the card says recording',
    async () => (await overlayState(page)) === 'recording',
    20_000,
  );
  const seen = await page.evaluate(() => {
    const host = document.querySelector('zen-recorder-overlay');
    const root = host?.shadowRoot ?? null;
    return {
      host: host !== null,
      open: root !== null,
      text: root?.querySelector('.zr-card')?.textContent?.trim() ?? null,
    };
  });
  console.log(
    `  the card's host is ${seen.host ? 'in the page' : 'missing'}; its shadow root is ${seen.open ? `open, and the page reads "${seen.text}"` : 'closed to the page'}`,
  );
  await page.evaluate(() => window.__fixture.hangup());
  const file = await waitForNewRecording(before);
  console.log(`  saved: ${path.basename(file)} → ${describeWebm(await inspectWebm(file))}`);
  await page.close();
  if (!seen.host) throw new Error('the page shows no status card');
  if (seen.open) {
    throw new Error(`the page reads the status card through its open shadow root: "${seen.text}"`);
  }
}
