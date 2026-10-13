/**
 * E2e scenario 8, run against every provider's fixture page: two tabs of one meeting stopped at
 * once (the same file name, a name new on disk) → two files.
 */
import path from 'node:path';
import { z } from 'zod';
import {
  backgroundDiagnostics,
  currentRecordingId,
  describeWebm,
  expectEqual,
  ffprobe,
  inspectWebm,
  listWebm,
  newRecordings,
  openMeeting,
  pageDiagnostics,
  pressCardButton,
  probe,
  sleep,
  waitFor,
  waitForCompleteFile,
} from './harness';
import type { ScenarioContext, ScenarioRegistration } from './order-scenarios';
import { meetingUrl } from './targets';
import { waitForFinalized } from './wait-for-finalized';

const videoModeSchema = z.object({ videoMode: z.string() });

/** `YYYY-MM-DD_HH-MM` in local time: how the default template names a recording's start minute. */
function minuteStamp(date: Date): string {
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_${pad(date.getHours())}-${pad(date.getMinutes())}`;
}

/**
 * Waits for the next minute when fewer than `secondsNeeded` are left in this one, and returns the
 * stamp of the minute the run goes on in.
 */
async function waitForMinuteRoom(secondsNeeded: number): Promise<string> {
  const now = new Date();
  if (60 - now.getSeconds() < secondsNeeded) {
    await sleep((60 - now.getSeconds()) * 1000 - now.getMilliseconds() + 500);
  }
  return minuteStamp(new Date());
}

export async function scenarioSameNameAtOnce({ browser, target }: ScenarioContext): Promise<void> {
  console.log(
    `▶ ${target.id} scenario 8: two recordings with the same name finalized at once → two files`,
  );
  const before = new Set(await listWebm());
  const pages = [
    await openMeeting(browser, meetingUrl(target)),
    await openMeeting(browser, meetingUrl(target)),
  ];
  const [first] = pages;
  if (!first) throw new Error('no page');
  try {
    const result = videoModeSchema.safeParse(await probe(first, 'settings:video-off'));
    if (!result.success || result.data.videoMode !== 'off') {
      throw new Error('could not switch video off through the debug probe');
    }
    // Two tabs of one meeting started in one minute render the same file name. Firefox uniquifies
    // a name already on disk, so the race only hits a new one: a title no earlier file has.
    const title = `Same name ${Date.now().toString(36)}`;
    for (const page of pages) await page.evaluate((name) => window.__fixture.setTitle(name), title);
    const minute = await waitForMinuteRoom(20);
    const ids: string[] = [];
    for (const page of pages) {
      // In front while it joins: Firefox defers device enumeration in a background tab.
      await page.bringToFront();
      await page.click('#start');
      ids.push(await waitFor('recording', () => currentRecordingId(page), 20_000));
    }
    if (minuteStamp(new Date()) !== minute) {
      throw new Error(`the recordings did not both start in ${minute}: their names differ`);
    }
    await sleep(5_000);
    const stoppedAt = new Date().toISOString().slice(11, 23);
    await Promise.all(pages.map((page) => pressCardButton(page, 'Stop')));
    console.log(`  Stop pressed in both tabs at ${stoppedAt}`);
    const finished = await waitForFinalized(first, ids);
    for (const recording of finished) {
      console.log(
        `  ${recording.id}: ${recording.status}${recording.error ? ` (${recording.error})` : ''}`,
      );
    }
    // Lines start with their UTC time, so sorting puts the two tabs' lines in order.
    const background = (await backgroundDiagnostics(first)).filter(
      (line) => line.includes(minute) || ids.some((id) => line.includes(id)),
    );
    const ended = (await pageDiagnostics(first)).filter(
      (line) => line.includes('recording ended') && line.slice(0, 12) >= stoppedAt,
    );
    for (const line of [...background, ...ended].sort()) console.log(`  diagnostics: ${line}`);
    await sleep(2_000);
    const files = await newRecordings(before);
    for (const file of files) {
      const info = await inspectWebm(await waitForCompleteFile(file));
      console.log(`  file: ${path.basename(file)} → ${describeWebm(info)}`);
      console.log(`    ffprobe: ${ffprobe(file)}`);
      if (!(info.durationS > 3)) throw new Error(`file too short: ${info.durationS} s`);
    }
    // Shortest first: `name.webm`, then the uniquified `name(1).webm`.
    const names = files.map((file) => path.basename(file)).sort((a, b) => a.length - b.length);
    expectEqual(names.length, 2, `files saved for two recordings started at ${minute}`);
    const [plain, numbered] = names;
    expectEqual(numbered, plain?.replace(/\.webm$/, '(1).webm'), 'name of the second file');
    for (const recording of finished) expectEqual(recording.status, 'saved', recording.id);
  } finally {
    await probe(first, 'settings:video-on');
  }
  for (const page of pages) await page.close();
}

export const registration = {
  name: '8',
  after: '7',
  scenario: scenarioSameNameAtOnce,
} satisfies ScenarioRegistration;
