/**
 * Records nothing a player could open: Record, then Stop as soon as the page can stop, before the
 * first audio or video sample reaches the recording. Scenarios 12 and 53 start the recordings the
 * background refuses to save this way.
 */
import type { Page } from 'puppeteer';

/** A sample can get into the recording before the Stop arrives: then the page tries again. */
export const STOP_AT_ONCE_ATTEMPTS = 3;

/**
 * Clicks Record, then Stop as soon as the page session has a recording id and the overlay shows
 * Stop. Inside the page, with no named function: tsx would wrap one in a helper the page lacks.
 */
export async function recordAndStopAtOnce(page: Page): Promise<string> {
  return page.evaluate(async () => {
    const started = performance.now();
    if (!window.__fixture.clickOverlay('Record')) throw new Error('no Record button');
    while (performance.now() - started < 10_000) {
      const id = window.__zenRecorderPage?.snapshot().recordingId;
      if (id && window.__fixture.clickOverlay('Stop')) return id;
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    throw new Error('no recording id and Stop button 10 s after Record');
  });
}
