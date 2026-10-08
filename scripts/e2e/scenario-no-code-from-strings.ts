/**
 * Scenario 39: a page whose Content Security Policy forbids eval, loaded, recorded, paused and
 * saved → it reports no code built from a string. The recorder's hook scripts run in the page's
 * own world, so the page sees every attempt, even one the recorder catches, and a policy with a
 * report URL tells the service. The fixture server sends every fake page such a policy as
 * report-only, so nothing is blocked, and collects its reports (`scripts/fixture-server.ts`).
 */
import path from 'node:path';
import type { Page } from 'puppeteer';
import {
  type CspReport,
  cspReports,
  describeWebm,
  inspectWebm,
  listWebm,
  openMeeting,
  recordingStarted,
  sleep,
  waitFor,
  waitForNewRecording,
} from './harness';
import type { ScenarioContext } from './scenarios';
import { meetingUrl } from './targets';

/** Code built from a string, as a report names it: `eval` under `script-src`, or its sink. */
const isCodeFromString = (report: CspReport): boolean =>
  report.blockedUri === 'eval' || /^(?:Function|eval)\|/.test(report.sample);

export async function scenarioNoCodeFromStrings({
  browser,
  target,
}: ScenarioContext): Promise<void> {
  console.log(
    `▶ ${target.id} scenario 39: load, record, pause and save in a page that forbids eval → the page reports no code built from a string`,
  );
  const since = Date.now();
  const before = new Set(await listWebm());
  const page = await openMeeting(browser, meetingUrl(target));
  // The reports are what this scenario is about: they are read even when the recording fails.
  const failure = await recordPauseAndSave(page, before).catch((error: unknown) => error);
  // The browser sends a report on its own time, and drops what a closed page has not sent yet.
  await sleep(1_000);
  await page.close();
  const reports = await cspReports(since);
  const fromStrings = reports.filter(isCodeFromString);
  console.log(
    `  CSP reports from the page: ${reports.length}, of code built from a string: ${fromStrings.length}`,
  );
  if (fromStrings.length > 0) {
    const named = new Set(
      fromStrings.map((report) =>
        report.sample === ''
          ? `${report.directive} ${report.blockedUri}`
          : (report.sample.split('\n')[0] ?? ''),
      ),
    );
    const recording =
      failure === undefined ? '' : ` (and the recording failed: ${String(failure)})`;
    throw new Error(
      `the page reported code built from a string ${fromStrings.length} time(s): ${[...named].join(' · ')}${recording}`,
    );
  }
  if (failure !== undefined) throw failure;
}

/** Joins, records with a pause and stops: the page and the bridge parse every kind of message. */
async function recordPauseAndSave(page: Page, before: ReadonlySet<string>): Promise<undefined> {
  await page.click('#start');
  await waitFor('recording started', () => recordingStarted(page), 20_000);
  await sleep(2_000);
  for (const button of ['Pause', 'Resume']) {
    await page.evaluate((name) => {
      if (!window.__fixture.clickOverlay(name)) throw new Error(`no ${name} button`);
    }, button);
    await sleep(1_000);
  }
  await page.evaluate(() => {
    if (!window.__fixture.clickOverlay('Stop')) throw new Error('no Stop button');
  });
  const file = await waitForNewRecording(before);
  console.log(`  saved: ${path.basename(file)} → ${describeWebm(await inspectWebm(file))}`);
  return undefined;
}
