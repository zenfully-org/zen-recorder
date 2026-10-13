/**
 * E2e scenario 2, run against every provider's fixture page: a tab that dies mid-recording without
 * its `pagehide` end (a crash) → a "(recovered)" file.
 */
import path from 'node:path';
import { dieLikeACrash } from './die-like-a-crash';
import {
  currentRecordingId,
  describeWebm,
  ffprobe,
  inspectWebm,
  listWebm,
  openMeeting,
  storedRecording,
  waitFor,
  waitForNewRecording,
} from './harness';
import type { ScenarioContext, ScenarioRegistration } from './order-scenarios';
import { meetingUrl } from './targets';

export async function scenarioRecoveryOnTabClose({
  browser,
  target,
}: ScenarioContext): Promise<void> {
  console.log(`▶ ${target.id} scenario 2: the tab dies mid-recording (a crash) → recovered file`);
  const before = new Set(await listWebm());
  const page = await openMeeting(browser, meetingUrl(target));
  await page.evaluate(() => window.__fixture.start());
  const id = await waitFor('recording started', () => currentRecordingId(page), 20_000);
  // Two chunks, not a fixed wait: a 6 s sleep raced the second 3 s chunk and sometimes left one.
  await waitFor(
    'two chunks stored',
    async () => ((await storedRecording(page, id))?.chunkCount ?? 0) > 1,
    20_000,
  );
  await dieLikeACrash(page);
  await page.close();
  const recovered = await waitForNewRecording(before, (file) => file.includes('(recovered)'));
  const info = await inspectWebm(recovered);
  console.log(`  recovered: ${path.basename(recovered)} → ${describeWebm(info)}`);
  console.log(`    ffprobe: ${ffprobe(recovered)}`);
  if (!Number.isFinite(info.durationS)) throw new Error('recovered file has no duration');
  if (!(info.durationS > 3)) throw new Error(`recovered duration too short: ${info.durationS}`);
}

export const registration = {
  name: '2',
  after: '98',
  scenario: scenarioRecoveryOnTabClose,
} satisfies ScenarioRegistration;
