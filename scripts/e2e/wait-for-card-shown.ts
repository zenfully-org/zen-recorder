/**
 * Waits until the status card shows: once the page names its meeting, the only time the card shows
 * and offers Record. A fake page can name it a tick after `openMeeting` returned: Teams' names a
 * meeting by its pre-join screen, which the recorder reads at its next tick, up to a second after
 * the load. A scenario that presses Record on a fresh page before that finds no button, since the
 * page refuses Record where it names no meeting.
 */
import type { Page } from 'puppeteer';
import { waitFor } from './harness';

export async function waitForCardShown(page: Page): Promise<void> {
  await waitFor(
    'the status card to show (the page names its meeting)',
    () => page.evaluate(() => window.__fixture.overlayState()?.visible === 'true'),
    10_000,
  );
}
