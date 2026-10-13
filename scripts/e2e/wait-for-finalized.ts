/**
 * Waits until the background has saved, or given up on, every recording a scenario names: what the
 * scenarios that stop several recordings at once, or one the background refuses to save, wait for
 * before they read the outcome.
 */
import type { Page } from 'puppeteer';
import { storedRecordings, waitFor } from './harness';

/** Waits until the background has saved, or given up on, every recording in `ids`. */
export async function waitForFinalized(page: Page, ids: string[]) {
  return waitFor(
    'recordings finalized',
    async () => {
      const done = (await storedRecordings(page)).filter(
        (recording) =>
          ids.includes(recording.id) &&
          (recording.status === 'saved' || recording.status === 'failed'),
      );
      return done.length === ids.length ? done : null;
    },
    60_000,
  );
}
