/**
 * Reloads the extension in the middle of a scenario, as an update does: the background and the
 * content scripts start again, and the meeting pages keep their recorders.
 */
import type { Browser, Page } from 'puppeteer';
import { EXTENSION_DIR, openMeeting } from './harness';
import { type FixtureTarget, meetingUrl } from './targets';

/** Reloads the extension (as in scenario 5) and opens a meeting page that is not joined. */
export async function reloadExtension(browser: Browser, target: FixtureTarget): Promise<Page> {
  await browser.installExtension(EXTENSION_DIR);
  return openMeeting(browser, meetingUrl(target));
}
