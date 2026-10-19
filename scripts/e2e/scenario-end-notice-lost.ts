/**
 * E2e scenario 15, run against every provider's fixture page: the Port drops while the recording
 * stops, as when the event page restarts → the page sends the end again, and the file is saved at
 * once under its own name, not "(recovered)".
 */
import path from 'node:path';
import { expectEventually } from './expect-eventually';
import {
  backgroundDiagnostics,
  briefStored,
  currentRecordingId,
  describeWebm,
  dropPortOnNextEnd,
  expectEqual,
  ffprobe,
  inspectWebm,
  listWebm,
  newRecordings,
  openMeeting,
  pageDiagnostics,
  pressCardButton,
  sleep,
  storedRecording,
  waitFor,
  waitForNewRecording,
} from './harness';
import type { ScenarioContext, ScenarioRegistration } from './order-scenarios';
import { meetingUrl } from './targets';
import { waitForEveryTrack } from './wait-for-every-track';

export async function scenarioEndNoticeLost({ browser, target }: ScenarioContext): Promise<void> {
  console.log(
    `▶ ${target.id} scenario 15: the Port drops while the recording stops → the end is sent again, the file saved under its own name`,
  );
  const before = new Set(await listWebm());
  // Diagnostics lines start with their UTC time: only the ones written from here on.
  const since = new Date().toISOString().slice(11, 23);
  const page = await openMeeting(browser, meetingUrl(target));
  await page.click('#start');
  const id = await waitFor('recording', () => currentRecordingId(page), 20_000);
  const stored = () => storedRecording(page, id);
  await waitForEveryTrack(page, id);
  await sleep(3_000);
  await dropPortOnNextEnd(page);
  await pressCardButton(page, 'Stop');
  const stoppedAt = Date.now();
  await waitFor(
    'the end notice posted while the Port is down',
    () => page.evaluate(() => window.__e2eEndReleased === true),
    20_000,
  );
  console.log('  the background dropped the Port while the recording stopped');
  const report = async () => {
    const seconds = Math.round((Date.now() - stoppedAt) / 1000);
    const notices = await page.evaluate(() => window.__e2eEndNotices ?? 0);
    console.log(
      `  ${seconds} s after Stop: ${JSON.stringify(briefStored(await stored()))}, ${notices} end(s) sent`,
    );
    const lines = [...(await pageDiagnostics(page)), ...(await backgroundDiagnostics(page))];
    for (const line of lines.filter((l) => l.slice(0, 12) >= since).sort()) {
      console.log(`  diagnostics: ${line}`);
    }
  };
  const file = await waitForNewRecording(before).catch(async (error: unknown) => {
    await report();
    throw error;
  });
  const savedAfterS = (Date.now() - stoppedAt) / 1000;
  // The file is complete on disk a moment before the background has marked the recording saved.
  await expectEventually(`status of ${id}`, async () => (await stored())?.status, 'saved');
  await report();
  const info = await inspectWebm(file);
  console.log(
    `  saved ${savedAfterS.toFixed(1)} s after Stop: ${path.basename(file)} → ${describeWebm(info)}`,
  );
  console.log(`    ffprobe: ${ffprobe(file)}`);
  // The first end found the Port down; the page sent it again until the background had it.
  const notices = await page.evaluate(() => window.__e2eEndNotices ?? 0);
  console.log(`  the page sent the end ${notices} times`);
  if (notices < 2) throw new Error(`the end was sent ${notices} time(s), never again`);
  if (file.includes('(recovered)')) throw new Error('a recording that ended cleanly was recovered');
  if (!(info.durationS > 4)) throw new Error(`file too short: ${info.durationS} s`);
  await sleep(3_000);
  expectEqual((await newRecordings(before)).length, 1, 'files saved for one recording');
  await page.close();
}

export const registration = {
  name: '15',
  after: '14',
  scenario: scenarioEndNoticeLost,
} satisfies ScenarioRegistration;
