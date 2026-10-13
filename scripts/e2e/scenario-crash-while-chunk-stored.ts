/**
 * E2e scenario 25, run against every provider's fixture page: a tab dies (a crash) while a chunk it
 * delivered is still being stored, so the chunk is stored after its Port dropped → the background
 * still takes the recording once its grace is over, and the "(recovered)" file holds that chunk.
 */
import path from 'node:path';
import { z } from 'zod';
import { dieLikeACrash } from './die-like-a-crash';
import { expectEventually } from './expect-eventually';
import {
  backgroundDiagnostics,
  currentRecordingId,
  describeWebm,
  expectEqual,
  ffprobe,
  inspectWebm,
  listWebm,
  newRecordings,
  openMeeting,
  probe,
  sleep,
  storedRecording,
  waitFor,
  waitForCompleteFile,
} from './harness';
import type { ScenarioContext, ScenarioRegistration } from './order-scenarios';
import { meetingUrl } from './targets';

const recoveredFiles = async (before: ReadonlySet<string>): Promise<string[]> =>
  (await newRecordings(before)).filter((file) => file.includes('(recovered)'));

const heldChunksSchema = z.object({ held: z.number() });

const releasedChunksSchema = z.object({ released: z.number() });

export async function scenarioCrashWhileChunkStored({
  browser,
  target,
}: ScenarioContext): Promise<void> {
  console.log(
    `▶ ${target.id} scenario 25: a tab dies while a chunk it delivered is still being stored → recovered with that chunk`,
  );
  const before = new Set(await listWebm());
  const since = new Date().toISOString().slice(11, 23);
  // Not in the call: it holds and releases the store, and reads the background's state.
  const control = await openMeeting(browser, meetingUrl(target));
  const page = await openMeeting(browser, meetingUrl(target));
  await page.click('#start');
  const id = await waitFor('recording', () => currentRecordingId(page), 20_000);
  const stored = () => storedRecording(control, id);
  await waitFor('two chunks stored', async () => ((await stored())?.chunkCount ?? 0) > 1, 20_000);
  await dieLikeACrash(page);
  // A busy store: the next chunk the tab delivers is stored only once the probe releases it.
  await probe(control, 'store:hold-next-chunk');
  await waitFor(
    'a chunk held in the store',
    async () => heldChunksSchema.parse(await probe(control, 'store:held-chunks')).held > 0,
    10_000,
  );
  const storedBefore = (await stored())?.chunkCount ?? 0;
  await page.close();
  const closedAt = Date.now();
  // The store answers a second after the tab died: its last chunk is stored after its Port dropped.
  await sleep(1_000);
  const { released } = releasedChunksSchema.parse(await probe(control, 'store:release-chunks'));
  expectEqual(released, 1, 'held chunks released');
  console.log(
    `  the tab died with chunk ${storedBefore} still being stored, stored ${((Date.now() - closedAt) / 1000).toFixed(1)} s later`,
  );
  const report = async () => {
    console.log(`    stored: ${JSON.stringify(await stored())}`);
    for (const line of (await backgroundDiagnostics(control)).filter(
      (l) => l.slice(0, 12) >= since && (l.includes(id) || l.includes('(recovered)')),
    )) {
      console.log(`    diagnostics: ${line}`);
    }
  };
  // The background's grace for a lost tab is 10 s.
  const file = await waitFor(
    'a "(recovered)" file',
    async () => (await recoveredFiles(before)).at(0),
    30_000,
  ).catch(async () => {
    await report();
    throw new Error(
      `no file ${((Date.now() - closedAt) / 1000).toFixed(1)} s after the tab died: still ${(await stored())?.status}`,
    );
  });
  const info = await inspectWebm(await waitForCompleteFile(file));
  console.log(
    `  recovered ${((Date.now() - closedAt) / 1000).toFixed(1)} s after the tab died: ${path.basename(file)} → ${describeWebm(info)}`,
  );
  console.log(`    ffprobe: ${ffprobe(file)}`);
  await expectEventually(
    'status of the recovered recording',
    async () => (await stored())?.status,
    'saved',
  );
  await report();
  const recording = await stored();
  if (!((recording?.chunkCount ?? 0) > storedBefore)) {
    throw new Error(
      `the held chunk is missing: ${recording?.chunkCount} chunks, ${storedBefore} before it`,
    );
  }
  if (!(info.durationS > 6)) throw new Error(`recovered file too short: ${info.durationS} s`);
  await control.close();
}

export const registration = {
  name: '25',
  after: '2',
  scenario: scenarioCrashWhileChunkStored,
} satisfies ScenarioRegistration;
