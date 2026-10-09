/**
 * Scenario 5: the extension is reloaded mid-recording → one complete file, nothing duplicated or
 * recovered. The background and the content script restart, but the recorder keeps running
 * inside the page. The new content script hands the recorder a new private port; the recorder
 * first checks that the one it had is gone (its content script ended, so it answers nothing) and
 * takes the new one after that check. The scenario times how long the recorder went without a
 * bridge, and checks that the file still covers the whole recording: what the page recorded
 * meanwhile waited in it.
 */
import path from 'node:path';
import {
  describeWebm,
  EXTENSION_DIR,
  expectEqual,
  inspectWebm,
  listWebm,
  openMeeting,
  overlayState,
  sleep,
  waitFor,
  waitForNewRecording,
} from './harness';
import type { ScenarioContext } from './scenarios';
import { meetingUrl } from './targets';

/** The recorder's check of the bridge it has, plus the new content script's start. */
const REPAIR_LIMIT_MS = 4_000;

export async function scenarioExtensionReload({ browser, target }: ScenarioContext): Promise<void> {
  console.log(
    `▶ ${target.id} scenario 5: extension reloaded mid-recording → one complete file, nothing recovered`,
  );
  const before = new Set(await listWebm());
  const page = await openMeeting(browser, meetingUrl(target));
  await page.click('#start');
  await waitFor('recording state', async () => (await overlayState(page)) === 'recording', 20_000);
  const startedAt = Date.now();
  // Notes the time of every message the recorder posts on a port it has not used before. No named
  // function inside the page: tsx would wrap it in a helper the page lacks.
  await page.evaluate(() => {
    const seen = new Set<unknown>();
    const firstPosts: number[] = [];
    Reflect.set(window, '__e2eFirstPosts', firstPosts);
    const post = MessagePort.prototype.postMessage;
    const descriptor: PropertyDescriptor = { configurable: true, writable: true };
    descriptor.value = function (this: MessagePort, ...args: unknown[]) {
      if (!seen.has(this)) {
        seen.add(this);
        firstPosts.push(performance.now());
      }
      return Reflect.apply(post, this, args);
    };
    Object.defineProperty(MessagePort.prototype, 'postMessage', descriptor);
  });
  await sleep(5_000);
  // Same as "Reload" in about:debugging: the background and content scripts restart, but the
  // MAIN-world recorder keeps running inside the page.
  const reloadedAt = await page.evaluate(() => performance.now());
  await browser.installExtension(EXTENSION_DIR);
  console.log('  extension reloaded while recording');
  await sleep(40_000); // longer than the recovery alarm (30 s) of the fresh background
  const firstPosts = await page.evaluate((): unknown => Reflect.get(window, '__e2eFirstPosts'));
  const repaired = Array.isArray(firstPosts)
    ? firstPosts.find((at): at is number => typeof at === 'number' && at > reloadedAt)
    : undefined;
  console.log(
    repaired === undefined
      ? '  the recorder posted on no new port after the reload (a build that talks on the window)'
      : `  the recorder posted to the new bridge ${((repaired - reloadedAt) / 1000).toFixed(2)} s after the reload`,
  );
  const overlays = await page.evaluate(
    () => document.querySelectorAll('zen-recorder-overlay').length,
  );
  expectEqual(overlays, 1, 'overlays after reload');
  expectEqual(await overlayState(page), 'recording', 'state after reload');
  await page.evaluate(() => window.__fixture.hangup());
  const endedAt = Date.now();
  const file = await waitForNewRecording(before);
  await sleep(5_000);
  const fresh = (await listWebm()).filter((saved) => !before.has(saved));
  for (const saved of fresh) {
    console.log(`  file: ${path.basename(saved)} → ${describeWebm(await inspectWebm(saved))}`);
  }
  expectEqual(fresh.length, 1, 'files saved by a recording that survived a reload');
  const info = await inspectWebm(file);
  if (info.tracks !== 2) throw new Error(`expected 2 tracks, got ${info.tracks}`);
  const recordedS = (endedAt - startedAt) / 1000;
  if (!(info.durationS > recordedS - 1.5)) {
    throw new Error(`recording was cut short: ${info.durationS} s of ${recordedS.toFixed(1)} s`);
  }
  if (repaired !== undefined && repaired - reloadedAt > REPAIR_LIMIT_MS) {
    throw new Error(
      `the recorder went ${((repaired - reloadedAt) / 1000).toFixed(2)} s without a bridge`,
    );
  }
  await page.close();
}
