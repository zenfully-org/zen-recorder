/**
 * E2e scenario 89, run against every provider's fixture page like the ones in `scenarios.ts`: the
 * audio tap runs on its AudioWorklet on every service, Teams included, and the page learns nothing
 * of the extension's per-install id on the way.
 *
 * Teams' CSP refuses scripts from `blob:` and `data:` URLs, so the tap's worklet module, loaded
 * from a blob, was refused there and a ScriptProcessor recorded on the main thread of a heavy
 * page. The module now comes from a file of the extension, whose `moz-extension:` URL Firefox
 * checks against no page's CSP. That URL names the extension's per-install id, which Firefox keeps
 * from pages, so it reaches the recorder only at document_start, before any script of the page,
 * and the recorder loads its modules through the `addModule` it found then.
 *
 * The fake page is opened with `observe`, which makes its first script record what a meeting
 * page's own scripts could see (`src/test/fixtures/page-observer.js`). Recorded twice, before and
 * after an extension reload (the page's recorder keeps the URL, which stays valid: the id belongs
 * to the install): the tap's path must be the worklet, from the extension's file on Teams and from
 * a blob elsewhere; the page's own `addModule` must have seen no call of the recorder; nothing the
 * page can read (its messages, dispatched events, resource timing, its window's properties, the
 * DOM) and no CSP report may name `moz-extension`.
 */
import path from 'node:path';
import type { Page } from 'puppeteer';
import { z } from 'zod';
import {
  cspReports,
  currentRecordingId,
  describeWebm,
  EXTENSION_DIR,
  expectEqual,
  inspectWebm,
  listWebm,
  openMeeting,
  pageDiagnostics,
  pressCardButton,
  sleep,
  waitFor,
  waitForNewRecording,
} from './harness';
import type { ScenarioContext } from './scenarios';
import { type FixtureTarget, meetingUrl } from './targets';

const observedSchema = z.object({
  addModule: z.array(z.object({ url: z.string(), fromPage: z.boolean() })),
  leaks: z.array(z.string()),
});

/** The fake page, with its observer on. */
const observedUrl = (target: FixtureTarget): string => {
  const url = meetingUrl(target);
  return `${url}${url.includes('?') ? '&' : '?'}observe`;
};

/** The tap path the recording that started after `since` reports, once it has one. */
async function tapPath(page: Page, since: number): Promise<string | null> {
  const lines = await pageDiagnostics(page, since);
  const line = lines.find((entry) => entry.includes('audio tap: '));
  return line ? line.slice(line.indexOf('audio tap: ') + 'audio tap: '.length) : null;
}

/** Records for a few seconds from `start`, and checks the tap's path and the saved file. */
async function recordOnce(page: Page, label: string, start: () => Promise<void>, want: string) {
  const before = new Set(await listWebm());
  const since = Date.now();
  await start();
  await waitFor(`${label}: recording`, () => currentRecordingId(page), 20_000);
  const tap = await waitFor(`${label}: the audio tap's path`, () => tapPath(page, since), 20_000);
  console.log(`  ${label}: audio tap: ${tap}`);
  expectEqual(tap, want, `${label}: the audio tap's path`);
  await sleep(3_000);
  await pressCardButton(page, 'Stop');
  const file = await waitForNewRecording(before);
  const info = await inspectWebm(file);
  console.log(`  ${label}: ${path.basename(file)} → ${describeWebm(info)}`);
  if (info.tracks !== 2)
    throw new Error(`${label}: expected video and audio, got ${info.tracks} track(s)`);
}

export async function scenarioWorkletFromExtension({
  browser,
  target,
}: ScenarioContext): Promise<void> {
  console.log(
    `▶ ${target.id} scenario 89: the audio tap runs on its worklet, and the page learns nothing of the extension's id`,
  );
  // Teams' policy refuses a blob module; the other services' allow it.
  const want = target.id === 'teams' ? "worklet (the extension's file)" : 'worklet';
  const since = Date.now();
  const page = await openMeeting(browser, observedUrl(target));
  await recordOnce(page, 'first recording', () => page.click('#start'), want);

  // Same as "Reload" in about:debugging: the recorder in the page keeps running, with its URL.
  await browser.installExtension(EXTENSION_DIR);
  console.log('  extension reloaded');
  await sleep(5_000);
  await recordOnce(
    page,
    'after the reload',
    async () => {
      await waitFor(
        "the new bridge's Record button",
        () => page.evaluate(() => window.__fixture.clickOverlay('Record')),
        20_000,
      );
    },
    want,
  );

  const observed = observedSchema.parse(await page.evaluate(() => window.__observed?.scan()));
  const recorderCalls = observed.addModule.filter((call) => !call.fromPage);
  console.log(
    `  the page's addModule: ${observed.addModule.length} call(s), ${recorderCalls.length} of the recorder`,
  );
  expectEqual(recorderCalls.length, 0, "the recorder's calls the page's addModule saw");
  for (const leak of observed.leaks) console.log(`  leak: ${leak}`);
  expectEqual(observed.leaks.length, 0, "places the page can read that name the extension's id");
  const reports = (await cspReports(since)).filter((report) =>
    `${report.blockedUri} ${report.sample}`.includes('moz-extension'),
  );
  expectEqual(reports.length, 0, "CSP reports that name the extension's id");
  await page.close();
}
