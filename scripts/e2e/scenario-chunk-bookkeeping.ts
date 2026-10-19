/**
 * E2e scenario 38, run against every provider's fixture page: the store answers a chunk after the
 * bridge's ack timeout, so the page sends it again → the chunks and bytes counted while recording
 * are those joined into the file. Then chunks of recordings that were never stored, one set a day
 * old and one just stored → the next background start deletes the old set and keeps the new one.
 */
import path from 'node:path';
import { z } from 'zod';
import { expectEventually } from './expect-eventually';
import {
  backgroundDiagnostics,
  currentRecordingId,
  expectEqual,
  listWebm,
  openMeeting,
  pressCardButton,
  probe,
  sleep,
  storedRecording,
  waitFor,
  waitForNewRecording,
} from './harness';
import type { ScenarioContext, ScenarioRegistration } from './order-scenarios';
import { reloadExtension } from './reload-extension';
import { meetingUrl } from './targets';
import { waitForFirstChunk } from './wait-for-first-chunk';

const videoModeSchema = z.object({ videoMode: z.string() });

const heldChunksSchema = z.object({ held: z.number() });

const releasedChunksSchema = z.object({ released: z.number() });

const strayChunksSchema = z.object({ stale: z.string(), recent: z.string() });

const recordingsWithChunksSchema = z.object({ ids: z.array(z.string()) });

export async function scenarioChunkBookkeeping({
  browser,
  target,
}: ScenarioContext): Promise<void> {
  console.log(
    `▶ ${target.id} scenario 38: a chunk stored after its ack timeout is counted once, and chunks whose recording was never stored are deleted once a day old`,
  );
  const problems: string[] = [];
  const before = new Set(await listWebm());
  const page = await openMeeting(browser, meetingUrl(target));
  try {
    const result = videoModeSchema.safeParse(await probe(page, 'settings:video-off'));
    if (!result.success || result.data.videoMode !== 'off') {
      throw new Error('could not switch video off through the debug probe');
    }
    await page.click('#start');
    const id = await waitFor('recording', () => currentRecordingId(page), 20_000);
    const stored = () => storedRecording(page, id);
    await waitForFirstChunk(page, id);
    // A busy store: the next chunk is stored only once the probe releases it.
    await probe(page, 'store:hold-next-chunk');
    await waitFor(
      'a chunk held in the store',
      async () => heldChunksSchema.parse(await probe(page, 'store:held-chunks')).held > 0,
      15_000,
    );
    const heldSeq = (await stored())?.chunkCount ?? 0;
    // The bridge gives up on the ack after 10 s and the page sends the chunk again 1 s later.
    // That send waits in the tab's queue behind the held one, which is stored first.
    await sleep(13_000);
    const { released } = releasedChunksSchema.parse(await probe(page, 'store:release-chunks'));
    expectEqual(released, 1, 'held chunks released');
    console.log(`  chunk ${heldSeq} held for 13 s, sent again by the page, then released`);
    // The chunk after the held one is sent only once the held one is acked, and the background
    // handles it after the second send of the held one.
    await waitFor(
      'the chunk after the held one stored',
      async () => ((await stored())?.chunkCount ?? 0) >= heldSeq + 2,
      20_000,
    );
    // While its save is held, the recording keeps the totals counted while it recorded: finalize
    // replaces the byte count with the saved file's size.
    await probe(page, 'save:hold-next');
    await pressCardButton(page, 'Stop');
    const counted = await waitFor(
      'the recording finalizing',
      async () => {
        const recording = await stored();
        return recording?.status === 'finalizing' ? recording : null;
      },
      30_000,
    );
    await probe(page, 'save:release');
    const file = await waitForNewRecording(before);
    // The background logs the save once the recording is marked saved, a moment after the file.
    await expectEventually(`status of ${id}`, async () => (await stored())?.status, 'saved');
    const lines = (await backgroundDiagnostics(page)).filter(
      (line) => line.includes(id) || line.includes(path.basename(file)),
    );
    for (const line of lines) console.log(`  diagnostics: ${line}`);
    const saved = lines
      .map((line) => line.match(/ info: saved .* \((\d+) chunks, (\d+) bytes\)$/))
      .find(Boolean);
    if (!saved) throw new Error(`no "saved" line for ${path.basename(file)}`);
    const [chunks, bytes] = [Number(saved[1]), Number(saved[2])];
    console.log(
      `  counted while recording: ${counted.chunkCount} chunks, ${counted.byteSize} bytes; joined into the file: ${chunks} chunks, ${bytes} bytes`,
    );
    if (counted.chunkCount !== chunks) {
      problems.push(`${counted.chunkCount} chunks counted, ${chunks} in the file`);
    }
    if (counted.byteSize !== bytes) {
      problems.push(`${counted.byteSize} bytes counted, ${bytes} in the file`);
    }
    const gap = lines.find((line) => line.includes('chunk sequence gap'));
    if (gap) problems.push(`a chunk is missing from the file: ${gap}`);
  } finally {
    await probe(page, 'settings:video-on');
  }

  const stray = strayChunksSchema.parse(await probe(page, 'store:put-stray-chunks'));
  await page.close();
  const control = await reloadExtension(browser, target);
  const startedAt = Date.now();
  const withChunks = async () =>
    recordingsWithChunksSchema.parse(await probe(control, 'store:recordings-with-chunks')).ids;
  // The recovery pass runs `TIMINGS.recoveryDelayMs` after the background starts.
  const deleted = await waitFor(
    'the stale stray chunks deleted',
    async () => !(await withChunks()).includes(stray.stale),
    60_000,
  ).catch(() => false);
  const left = await withChunks();
  const lines = (await backgroundDiagnostics(control)).filter(
    (line) => line.includes(stray.stale) || line.includes(stray.recent),
  );
  for (const line of lines) console.log(`  diagnostics: ${line}`);
  console.log(
    `  ${((Date.now() - startedAt) / 1000).toFixed(1)} s after the background started: stale stray chunks ${left.includes(stray.stale) ? 'still stored' : 'deleted'}, recent ones ${left.includes(stray.recent) ? 'kept' : 'deleted'}`,
  );
  if (!deleted) {
    problems.push('chunks no recording was stored for, 25 h old, are still stored after the pass');
  }
  if (!left.includes(stray.recent)) {
    problems.push('chunks no recording was stored for, just stored, were deleted');
  }
  if (deleted && !lines.some((line) => line.includes(`deleted 2 chunks of ${stray.stale}`))) {
    problems.push('Diagnostics do not say that the stale stray chunks were deleted');
  }
  await control.close();
  if (problems.length > 0) throw new Error(problems.join('; '));
}

export const registration = {
  name: '38',
  // It reloads the extension, as the ones after it do.
  after: '84',
  scenario: scenarioChunkBookkeeping,
} satisfies ScenarioRegistration;
