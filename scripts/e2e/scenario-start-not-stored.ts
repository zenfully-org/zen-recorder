/**
 * E2e scenario 41, run against every provider's fixture page like the ones in `scenarios.ts`: the
 * background fails to store a recording's start (a full disk), and the page announces it only once
 * → the start is stored with the next chunk, Diagnostics say what happened, and one complete file
 * is saved under its own name at Stop.
 */
import path from 'node:path';
import { z } from 'zod';
import {
  backgroundDiagnostics,
  currentRecordingId,
  describeWebm,
  expectEqual,
  ffprobe,
  inspectWebm,
  listWebm,
  openMeeting,
  pageDiagnostics,
  probe,
  sleep,
  waitFor,
  waitForNewRecording,
} from './harness';
import type { ScenarioContext } from './scenarios';
import { meetingUrl } from './targets';

const recordingsSchema = z.object({
  recordings: z.array(
    z.object({ id: z.string(), status: z.string(), chunkCount: z.number(), byteSize: z.number() }),
  ),
});
const armedSchema = z.object({ armed: z.literal(true) });

/** How long the recording runs: a few chunks, the first of them the one that stores the start. */
const RECORDING_MS = 8_000;

export async function scenarioStartNotStored({ browser, target }: ScenarioContext): Promise<void> {
  console.log(
    `▶ ${target.id} scenario 41: the background fails to store a recording's start → stored with its next chunk, one complete file`,
  );
  const before = new Set(await listWebm());
  const page = await openMeeting(browser, meetingUrl(target));
  // Lines start with their UTC time: the background's lines from now on, whatever they name.
  const since = new Date().toISOString().slice(11, 23);
  const backgroundLines = async () =>
    (await backgroundDiagnostics(page)).filter((line) => line.slice(0, 12) >= since);
  const storedRecording = async (id: string) => {
    const { recordings } = recordingsSchema.parse(await probe(page, 'background:state'));
    return recordings.find((candidate) => candidate.id === id);
  };
  const describeStored = async (id: string) =>
    JSON.stringify((await storedRecording(id)) ?? 'no recording stored');

  armedSchema.parse(await probe(page, 'store:fail-next-recording'));
  console.log("  the next recording's start fails to store");
  await page.click('#start');
  const id = await waitFor('recording', () => currentRecordingId(page), 20_000);
  await sleep(RECORDING_MS);
  console.log(`  before Stop: ${await describeStored(id)}`);
  await page.evaluate(() => window.__fixture.clickOverlay('Stop'));
  const saved = await waitForNewRecording(before).catch(async (error: unknown) => {
    console.log(`  60 s after Stop: ${await describeStored(id)}`);
    for (const line of await backgroundLines()) console.log(`  diagnostics: ${line}`);
    throw error;
  });

  const lines = await backgroundLines();
  const pageEnd = (await pageDiagnostics(page)).findLast((line) =>
    line.includes('recording ended'),
  );
  for (const line of [...lines, pageEnd ?? '(no page line)'].sort()) {
    console.log(`  diagnostics: ${line}`);
  }
  const info = await inspectWebm(saved);
  console.log(`  file: ${path.basename(saved)} → ${describeWebm(info)}`);
  console.log(`    ffprobe: ${ffprobe(saved)}`);
  console.log(`  stored: ${await describeStored(id)}`);

  const refusedAt = lines.findIndex((line) => line.includes(`start of recording ${id}`));
  if (refusedAt === -1) throw new Error('the start was stored at once: the fault did not happen');
  const startedAt = lines.findIndex((line) => line.includes(`recording ${id} started`));
  if (startedAt < refusedAt) throw new Error('Diagnostics do not say the start was stored later');
  // Every chunk the page recorded is in the file, the ones stored before the start too.
  const recorded = pageEnd?.match(/after (\d+) chunks/)?.[1];
  const joined = lines.map((line) => line.match(/ info: saved .* \((\d+) chunks, /)?.[1]);
  expectEqual(joined.find(Boolean), recorded, 'chunks in the file (the page recorded)');
  expectEqual((await storedRecording(id))?.status, 'saved', 'status of the recording');
  if (!(info.durationS > 5)) throw new Error(`file too short: ${info.durationS} s`);
  if (!info.video) throw new Error('the file has no video track');
  await page.close();
}
