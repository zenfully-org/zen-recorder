/**
 * Waits until the background has saved, or given up on, every recording a scenario names: what the
 * scenarios that stop several recordings at once, or one the background refuses to save, wait for
 * before they read the outcome.
 */
import type { Page } from 'puppeteer';
import { z } from 'zod';
import { probe, waitFor } from './harness';

const backgroundStateSchema = z.object({
  recordings: z.array(
    z.object({ id: z.string(), status: z.string(), error: z.string().nullish() }),
  ),
});

/** Waits until the background has saved, or given up on, every recording in `ids`. */
export async function waitForFinalized(page: Page, ids: string[]) {
  return waitFor(
    'recordings finalized',
    async () => {
      const state = backgroundStateSchema.parse(await probe(page, 'background:state'));
      const done = state.recordings.filter(
        (recording) =>
          ids.includes(recording.id) &&
          (recording.status === 'saved' || recording.status === 'failed'),
      );
      return done.length === ids.length ? done : null;
    },
    60_000,
  );
}
