/**
 * Waits until a recording has a sample of every track in what the background stored: what a
 * scenario that stops a recording and expects its file waits for before the stop. A recording
 * stopped before its first sample saves nothing, by design (such a file has no track), and on a
 * slow machine that sample can come seconds after the page started the recording.
 *
 * The first stored chunk proves no sample. The muxer writes the file's header at the start, then
 * nothing until every track has had a sample (Mediabunny's Matroska muxer holds every block until
 * then), and the page cuts a chunk 3 s after the first byte it has not handed on. So the first
 * chunk is the header alone when the samples come later than that. A second chunk cut while the
 * recording runs holds bytes written after the header: a sample of each track was in by then.
 * A recording without video goes through Firefox's `MediaRecorder`, whose first chunk holds the
 * header and whose later ones hold only clusters of encoded audio, so a second chunk proves a
 * sample there too.
 */
import type { Page } from 'puppeteer';
import { storedRecording, waitFor } from './harness';

/** The first samples, then two chunks of 3 s each, with room for a slow machine. */
const EVERY_TRACK_WAIT_MS = 30_000;

/** Waits until the background has stored two chunks of recording `id`, read through `page`. */
export async function waitForEveryTrack(
  page: Page,
  id: string,
  timeoutMs = EVERY_TRACK_WAIT_MS,
): Promise<void> {
  await waitFor(
    `a sample of every track of ${id} stored (two chunks)`,
    async () => ((await storedRecording(page, id))?.chunkCount ?? 0) > 1,
    timeoutMs,
  );
}
