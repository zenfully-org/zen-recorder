/**
 * E2e scenario 9, run against every provider's fixture page: the background fails to store one
 * chunk → the page sends it again, one complete file.
 */
import path from 'node:path';
import { z } from 'zod';
import { expectEventually } from './expect-eventually';
import {
  backgroundDiagnostics,
  briefStored,
  currentRecordingId,
  describeWebm,
  expectEqual,
  ffprobe,
  inspectWebm,
  listWebm,
  openMeeting,
  pageDiagnostics,
  pressCardButton,
  probe,
  sleep,
  storedRecording,
  waitFor,
  waitForNewRecording,
} from './harness';
import type { ScenarioContext, ScenarioRegistration } from './order-scenarios';
import { meetingUrl } from './targets';

const videoModeSchema = z.object({ videoMode: z.string() });

export async function scenarioChunkNotStored({ browser, target }: ScenarioContext): Promise<void> {
  console.log(
    `▶ ${target.id} scenario 9: one chunk fails to store → sent again, one complete file`,
  );
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
    // Once the header chunk is stored, so the chunk that fails is one in the middle of the file.
    await waitFor('the first chunk stored', async () => (await stored())?.chunkCount, 15_000);
    console.log(
      `  fail the next chunk: ${JSON.stringify(await probe(page, 'store:fail-next-chunk'))}`,
    );
    // A chunk without an ack is sent again once the bridge's 10 s ack timeout has passed.
    await sleep(16_000);
    console.log(`  before Stop: ${JSON.stringify(briefStored(await stored()))}`);
    await pressCardButton(page, 'Stop');
    const linesOf = async (file?: string) =>
      (await backgroundDiagnostics(page)).filter(
        (line) => line.includes(id) || (file !== undefined && line.includes(path.basename(file))),
      );
    const file = await waitForNewRecording(before).catch(async (error: unknown) => {
      console.log(`  60 s after Stop: ${JSON.stringify(briefStored(await stored()))}`);
      for (const line of await linesOf()) console.log(`  diagnostics: ${line}`);
      throw error;
    });
    // The background logs the save once the recording is marked saved, a moment after the file.
    await expectEventually(`status of ${id}`, async () => (await stored())?.status, 'saved');
    const lines = await linesOf(file);
    const ended = (await pageDiagnostics(page)).filter((line) => line.includes('recording ended'));
    for (const line of [...lines, ...ended.slice(-1)].sort()) console.log(`  diagnostics: ${line}`);
    const info = await inspectWebm(file);
    console.log(`  saved: ${path.basename(file)} → ${describeWebm(info)}`);
    console.log(`    ffprobe: ${ffprobe(file)}`);
    if (!lines.some((line) => line.includes('could not handle chunk'))) {
      throw new Error('no chunk failed: the injected store failure did not happen');
    }
    const gap = lines.find((line) => line.includes('chunk sequence gap'));
    if (gap) throw new Error(`a chunk is missing from the file: ${gap}`);
    // Every chunk the page recorded is in the file: the one that failed was stored when resent.
    const sent = ended.at(-1)?.match(/after (\d+) chunks/)?.[1];
    if (sent === undefined) throw new Error('the page logged no "recording ended" line');
    const saved = lines.map((line) => line.match(/^\S+ info: saved .* \((\d+) chunks/)?.[1]);
    expectEqual(saved.find(Boolean), sent, 'chunks in the file (the page recorded)');
    if (!(info.durationS > 10)) throw new Error(`file too short: ${info.durationS} s`);
  } finally {
    await probe(page, 'settings:video-on');
  }
  await page.close();
}

export const registration = {
  name: '9',
  after: '8',
  scenario: scenarioChunkNotStored,
} satisfies ScenarioRegistration;
