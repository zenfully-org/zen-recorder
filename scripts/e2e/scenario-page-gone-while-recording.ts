/**
 * E2e scenario 20, run against every provider's fixture page: the meeting page goes away while it
 * records, by a navigation right after leaving, before the stop is done, then by a closed tab →
 * each file saved within seconds under its own name, not "(recovered)".
 */
import path from 'node:path';
import type { Page } from 'puppeteer';
import { expectEventually } from './expect-eventually';
import {
  backgroundDiagnostics,
  briefStored,
  currentRecordingId,
  describeWebm,
  ffprobe,
  inspectWebm,
  listWebm,
  newRecordings,
  openMeeting,
  pageDiagnostics,
  sleep,
  storedRecording,
  waitFor,
  waitForNewRecording,
} from './harness';
import type { ScenarioContext, ScenarioRegistration } from './order-scenarios';
import { meetingUrl } from './targets';

declare module './harness' {
  interface FixtureApi {
    /** Hangs up and navigates to a non-meeting route of the service. */
    leave(): void;
  }
}

/** Where the meeting page goes in scenario 20: away from the service, as a typed address does. */
const AWAY_URL = 'about:blank';

/** The background waits 10 s for a lost tab before it saves the recording as "(recovered)". */
const SAVED_WITHIN_S = 8;

export async function scenarioPageGoneWhileRecording({
  browser,
  target,
}: ScenarioContext): Promise<void> {
  console.log(
    `▶ ${target.id} scenario 20: the page goes away while it records → saved at once under its own name`,
  );
  // Not in the call: it reads the background's state once a meeting tab is gone.
  const control = await openMeeting(browser, meetingUrl(target));
  const problems: string[] = [];
  /**
   * Records in a new meeting tab until two chunks are stored, lets `goAway` end the page, and
   * checks the file: saved before the background's grace for a lost tab is over, under its own
   * name, one file.
   */
  const recordUntilGone = async (label: string, goAway: (page: Page) => Promise<number>) => {
    const before = new Set(await listWebm());
    const since = new Date().toISOString().slice(11, 23);
    const page = await openMeeting(browser, meetingUrl(target));
    await page.click('#start');
    const id = await waitFor('recording', () => currentRecordingId(page), 20_000);
    const stored = () => storedRecording(control, id);
    await waitFor('two chunks stored', async () => ((await stored())?.chunkCount ?? 0) > 1, 20_000);
    const goneAt = await goAway(page);
    const report = async () => {
      console.log(`    stored: ${JSON.stringify(briefStored(await stored()))}`);
      const lines = [
        ...(await pageDiagnostics(control)),
        ...(await backgroundDiagnostics(control)),
      ];
      for (const line of lines.filter((l) => l.slice(0, 12) >= since).sort()) {
        console.log(`    diagnostics: ${line}`);
      }
    };
    const file = await waitForNewRecording(before).catch(() => null);
    const savedAfterS = (Date.now() - goneAt) / 1000;
    if (!file) {
      console.log(`  ${label}: no file ${savedAfterS.toFixed(1)} s after the page went away`);
      await report();
      problems.push(`${label}: no file saved`);
      if (!page.isClosed()) await page.close();
      return;
    }
    const info = await inspectWebm(file);
    console.log(
      `  ${label}: saved ${savedAfterS.toFixed(1)} s later as ${path.basename(file)} → ${describeWebm(info)}`,
    );
    console.log(`    ffprobe: ${ffprobe(file)}`);
    await report();
    if (file.includes('(recovered)')) problems.push(`${label}: saved as "(recovered)"`);
    if (savedAfterS > SAVED_WITHIN_S) {
      problems.push(`${label}: saved ${savedAfterS.toFixed(1)} s after the page went away`);
    }
    await expectEventually(`${label}: status`, async () => (await stored())?.status, 'saved').catch(
      (error: unknown) => problems.push(error instanceof Error ? error.message : String(error)),
    );
    if (!(info.durationS > 3)) problems.push(`${label}: file too short (${info.durationS} s)`);
    await sleep(2_000);
    const files = (await newRecordings(before)).length;
    if (files !== 1) problems.push(`${label}: ${files} files for one recording`);
    if (!page.isClosed()) await page.close();
  };

  // The user leaves and the page navigates before the stop is done: Zoom's Leave on a busy
  // machine, or the OK of "ended by the host" right away. The page's own end never leaves it.
  await recordUntilGone('navigated away right after leaving', (page) =>
    page.evaluate((url) => {
      window.__fixture.leave();
      location.assign(url);
      return Date.now();
    }, AWAY_URL),
  );
  await recordUntilGone('tab closed', async (page) => {
    const goneAt = Date.now();
    await page.close();
    return goneAt;
  });
  await control.close();
  if (problems.length > 0) throw new Error(problems.join('; '));
}

export const registration = {
  name: '20',
  after: '17',
  scenario: scenarioPageGoneWhileRecording,
} satisfies ScenarioRegistration;
