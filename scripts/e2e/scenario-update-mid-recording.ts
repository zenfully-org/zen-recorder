/**
 * E2e scenario 88, run against every provider's fixture page like the ones in `scenarios.ts`: the
 * add-on is updated to today's build in the middle of a call, the way a person's copy updates
 * itself.
 *
 * The recorder in the meeting page outlives an update: the page keeps the previous release's
 * recorder, and today's bridge and background take it on. Scenario 5 reinstalls the same build,
 * so both sides always speak the same protocol; here they do not.
 *
 * The scenario builds the previous release (`buildUpgradeBase`: the newest `v*` tag, or the first
 * public commit until one is tagged), runs a browser of its own with it, joins and records, then
 * installs today's build. Past the fresh background's recovery alarm (30 s) the status card must
 * say recording, and the hang-up must save that recording as one complete file. Then:
 *   - a second call in the same tab saves one complete file. On Meet and Teams the page rejoins and
 *     the previous release's recorder records it; Zoom's client loads its page anew after leaving,
 *     so there today's recorder does;
 *   - a call in a new tab, today's recorder, saves one complete file.
 * Nothing may be saved as "(recovered)", and nothing else may be saved.
 */
import path from 'node:path';
import type { Browser, Page } from 'puppeteer';
import { buildUpgradeBase } from './build-upgrade-base';
import {
  currentRecordingId,
  describeWebm,
  EXTENSION_DIR,
  expectEqual,
  inspectWebm,
  launch,
  listWebm,
  newRecordings,
  openMeeting,
  overlayState,
  sleep,
  waitFor,
  waitForExtensionReady,
  waitForNewRecording,
} from './harness';
import type { ScenarioContext } from './scenarios';
import { type FixtureTarget, meetingUrl } from './targets';

/** Longer than the recovery alarm (30 s) of the background today's build starts. */
const AFTER_UPDATE_MS = 40_000;
/** Marks the document the previous release's recorder runs in. */
const MARK = '__e2eBeforeUpdate';

/** Opens the meeting under the previous release: only what any build's test flavour offers. */
async function openUnderPreviousRelease(browser: Browser, target: FixtureTarget): Promise<Page> {
  const page = await browser.newPage();
  page.on('console', (msg) => {
    const text = msg.text();
    if (text.includes('zen-recorder') || text.includes('[fixture]'))
      console.log(`  [page] ${text}`);
  });
  await page.goto(meetingUrl(target), { waitUntil: 'load' });
  await waitFor(
    'the page recorder',
    () => page.evaluate(() => typeof window.__zenRecorderPage === 'object'),
    10_000,
  );
  await page.evaluate((mark) => Reflect.set(window, mark, true), MARK);
  return page;
}

/** Hangs up and returns the recording's file, which must be complete and whole. */
async function hangUpAndCheck(page: Page, before: ReadonlySet<string>, minS: number) {
  await page.evaluate(() => window.__fixture.hangup());
  const file = await waitForNewRecording(before);
  const info = await inspectWebm(file);
  console.log(`  saved: ${path.basename(file)} → ${describeWebm(info)}`);
  if (file.includes('(recovered)')) throw new Error(`saved as recovered: ${file}`);
  if (info.tracks !== 2) throw new Error(`expected audio and video, got ${info.tracks} track(s)`);
  if (!(info.durationS > minS))
    throw new Error(`cut short: ${info.durationS} s, ${minS} s at least`);
  return file;
}

/** Joins in `page` and records a few seconds: the call's recording id. */
async function recordACall(page: Page, previous: string | null): Promise<string> {
  await page.click('#start');
  const id = await waitFor(
    'a new recording',
    async () => {
      const current = await currentRecordingId(page);
      return current !== null && current !== previous ? current : null;
    },
    30_000,
  );
  await sleep(5_000);
  return id;
}

async function secondCallInTheSameTab(page: Page, target: FixtureTarget, first: string) {
  // Give a client that leaves by loading its page anew the time to do it.
  await sleep(3_000);
  const sameDocument = await page.evaluate((mark) => Reflect.get(window, mark) === true, MARK);
  if (!sameDocument) await page.goto(meetingUrl(target), { waitUntil: 'load' });
  console.log(
    `  second call in the same tab, ${sameDocument ? "the previous release's" : "today's"} recorder`,
  );
  await recordACall(page, sameDocument ? first : null);
}

export async function scenarioUpdateMidRecording({ target }: ScenarioContext): Promise<void> {
  console.log(
    `▶ ${target.id} scenario 88: the add-on is updated mid-recording → one complete file per call, nothing recovered`,
  );
  const base = buildUpgradeBase();
  console.log(`  updating from ${base.name}`);
  const start = new Set(await listWebm());
  const browser = await launch();
  try {
    await browser.installExtension(base.dir);
    await waitForExtensionReady(browser, meetingUrl(target));
    const page = await openUnderPreviousRelease(browser, target);
    const first = await recordACall(page, null);
    await browser.installExtension(EXTENSION_DIR);
    console.log("  updated to today's build while recording");
    await sleep(AFTER_UPDATE_MS);
    const overlays = await page.evaluate(
      () => document.querySelectorAll('zen-recorder-overlay').length,
    );
    expectEqual(overlays, 1, 'status cards after the update');
    expectEqual(await overlayState(page), 'recording', 'the card after the update');
    expectEqual(await currentRecordingId(page), first, 'the recording after the update');
    let before = new Set(await listWebm());
    await hangUpAndCheck(page, before, AFTER_UPDATE_MS / 1000);
    before = new Set(await listWebm());
    await secondCallInTheSameTab(page, target, first);
    await hangUpAndCheck(page, before, 3);
    before = new Set(await listWebm());
    const fresh = await openMeeting(browser, meetingUrl(target));
    await recordACall(fresh, null);
    await hangUpAndCheck(fresh, before, 3);
    await sleep(5_000);
    const saved = await newRecordings(start);
    expectEqual(
      saved.length,
      3,
      `files saved (${saved.map((file) => path.basename(file)).join(', ')})`,
    );
  } finally {
    await browser.close();
  }
}
