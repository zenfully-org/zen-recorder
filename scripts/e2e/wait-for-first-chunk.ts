/**
 * Waits until the background has stored a recording's first chunk, the one that starts with the
 * file's header: what a scenario waits for before it takes the store away (chunks that fail or
 * wait, an outage). A file without its first chunk has no header, and nothing saves it. The first
 * chunk proves no sample: a scenario that stops the recording and expects its file waits for
 * `waitForEveryTrack` instead.
 */
import type { Page } from 'puppeteer';
import { storedRecording, waitFor } from './harness';

/** The first chunk is cut 3 s after the page started the recording; room for a slow machine. */
const FIRST_CHUNK_WAIT_MS = 20_000;

/** Waits until the background has stored a chunk of recording `id`, read through `page`. */
export async function waitForFirstChunk(
  page: Page,
  id: string,
  timeoutMs = FIRST_CHUNK_WAIT_MS,
): Promise<void> {
  await waitFor(
    `the first chunk of ${id} stored`,
    async () => ((await storedRecording(page, id))?.chunkCount ?? 0) > 0,
    timeoutMs,
  );
}
