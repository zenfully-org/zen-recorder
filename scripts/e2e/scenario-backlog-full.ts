/**
 * E2e scenario 33, run against every provider's fixture page: the extension takes no chunk for a
 * long time (a full disk, a store that hangs) → the recording with video stops once the page holds
 * its limit, the rest records audio only at once, and when the extension is back both files are
 * saved whole, no chunk dropped.
 */
import path from 'node:path';
import { z } from 'zod';
import {
  backgroundDiagnostics,
  briefStored,
  currentRecordingId,
  describeWebm,
  expectEqual,
  ffprobe,
  inspectWebm,
  listWebm,
  newRecordings,
  openMeeting,
  pageDiagnostics,
  probe,
  recordingStartedAt,
  sleep,
  storedRecordings,
  waitFor,
  waitForCompleteFile,
} from './harness';
import type { ScenarioContext, ScenarioRegistration } from './order-scenarios';
import { meetingUrl } from './targets';

/**
 * The page's backlog limit in scenario 33: the fixture's video fills it in 10-30 s. Any limit the
 * video fills proves the same; a bigger one only makes the run wait longer. Not smaller: a page that
 * keeps up still holds its chunks until they are acked, two of the Teams fixture's are over
 * 512 KiB, and a limit they reach stops the video before the store holds anything.
 */
const SMALL_BACKLOG_BYTES = 2 ** 20;

const pageStateSchema = z.object({
  id: z.string().nullable(),
  debug: z.object({
    video: z.unknown().nullable(),
    backlog: z.object({ bytes: z.number(), chunks: z.number() }).nullable(),
  }),
});

export async function scenarioBacklogFull({ browser, target }: ScenarioContext): Promise<void> {
  console.log(
    `▶ ${target.id} scenario 33: the extension takes no chunk for a long time → the video stops at the page's limit, audio goes on, nothing is dropped`,
  );
  const before = new Set(await listWebm());
  const since = Date.now();
  const page = await openMeeting(browser, meetingUrl(target));
  const limit = await page.evaluate(
    (bytes) => window.__zenRecorderPage?.setBacklogLimit?.(bytes) ?? null,
    SMALL_BACKLOG_BYTES,
  );
  if (limit?.backlogLimitBytes !== SMALL_BACKLOG_BYTES) {
    throw new Error("this build cannot lower the page's backlog limit");
  }
  await page.click('#start');
  const first = await waitFor('recording', () => currentRecordingId(page), 20_000);
  const firstStartedAt = await recordingStartedAt(page);
  const recordings = () => storedRecordings(page);
  const stored = async (id: string) => (await recordings()).find((r) => r.id === id);
  await waitFor('the first chunk stored', async () => (await stored(first))?.chunkCount, 15_000);
  // The store stops answering: the tab's chunks wait, as they do on a full disk or with no bridge.
  console.log(`  hold the store: ${JSON.stringify(await probe(page, 'store:hold-next-chunk'))}`);
  const heldAt = Date.now();
  const readPage = async () =>
    pageStateSchema.parse(
      await page.evaluate(() => ({
        id: window.__zenRecorderPage?.snapshot().recordingId ?? null,
        debug: window.__zenRecorderPage?.debug(),
      })),
    );
  let peak = 0;
  const next = await waitFor(
    'an audio-only recording once the video filled the backlog',
    async () => {
      const state = await readPage();
      peak = Math.max(peak, state.id === first ? (state.debug.backlog?.bytes ?? 0) : 0);
      return state.id !== null && state.id !== first && state.debug.video === null
        ? state.id
        : null;
    },
    120_000,
  ).finally(async () => {
    console.log(`  background: ${JSON.stringify((await recordings()).map(briefStored))}`);
  });
  const switchedS = (Date.now() - heldAt) / 1000;
  const nextStartedAt = await recordingStartedAt(page);
  console.log(
    `  ${switchedS.toFixed(1)} s after the hold: audio only (${next}); the video's backlog peaked at ${peak} bytes before it filled`,
  );
  if (peak > SMALL_BACKLOG_BYTES) {
    throw new Error(`the page held ${peak} bytes, more than its limit of ${SMALL_BACKLOG_BYTES}`);
  }
  // The audio goes on beside the full backlog while the store still holds everything.
  await sleep(8_000);
  const audio = await readPage();
  console.log(`  audio-only backlog after 8 s: ${JSON.stringify(audio.debug.backlog)}`);
  expectEqual(audio.id, next, 'recording while the store still holds');
  // Hung up while it still holds: once the extension took the video recording, a meeting still on
  // would record with video again (scenario 62). Meet notices a hang-up seconds later.
  await page.evaluate(() => window.__fixture.hangup());
  await waitFor('the meeting over', async () => (await currentRecordingId(page)) === null, 20_000);
  console.log(`  release the store: ${JSON.stringify(await probe(page, 'store:release-chunks'))}`);
  await waitFor(
    `${first} saved`,
    async () => (await stored(first))?.status === 'saved',
    60_000,
  ).catch(async (error: unknown) => {
    console.log(`  background: ${JSON.stringify((await recordings()).map(briefStored))}`);
    throw error;
  });
  const files = await waitFor(
    'the video file and the audio-only one',
    async () => {
      const saved = await newRecordings(before);
      return saved.length >= 2 ? saved : null;
    },
    60_000,
  );
  // Every line checked below was written before the files were saved.
  const pageLines = await pageDiagnostics(page, since);
  const backgroundLines = (await backgroundDiagnostics(page)).filter((line) =>
    [first, next, ...files.map((file) => path.basename(file))].some((part) => line.includes(part)),
  );
  for (const line of [...pageLines, ...backgroundLines].sort()) {
    if (/backlog|recording ended|saved|gap|could not/.test(line))
      console.log(`  diagnostics: ${line}`);
  }
  const full = pageLines.find((line) => line.includes(`backlog full:`) && line.includes(first));
  if (!full?.includes('the rest of the meeting records audio only')) {
    throw new Error('Diagnostics do not say why the video recording stopped');
  }
  const gap = backgroundLines.find((line) => line.includes('chunk sequence gap'));
  if (gap) throw new Error(`a chunk is missing from a file: ${gap}`);
  // The page's two "recording ended" lines, in order: the video recording's, then the audio one's.
  const ended = pageLines.filter((line) => line.includes('recording ended'));
  if (!ended[0]?.includes('recording ended (backlog-full)')) {
    throw new Error(`the video recording did not end as backlog-full: ${ended[0]}`);
  }
  // Every chunk the page recorded is in its file.
  for (const [index, id] of [first, next].entries()) {
    const sent = ended[index]?.match(/after (\d+) chunks/)?.[1] ?? 'none';
    expectEqual(String((await stored(id))?.chunkCount), sent, `chunks stored for ${id}`);
  }
  const infos = await Promise.all(
    files.map(async (file) => ({ file, info: await inspectWebm(await waitForCompleteFile(file)) })),
  );
  for (const { file, info } of infos) {
    console.log(`  file: ${path.basename(file)} → ${describeWebm(info)}`);
    console.log(`    ffprobe: ${ffprobe(file)}`);
  }
  const withVideo = infos.filter(({ info }) => info.video !== null);
  const audioOnly = infos.filter(({ info }) => info.video === null && info.tracks === 1);
  expectEqual(withVideo.length, 1, 'files with video');
  expectEqual(audioOnly.length, 1, 'audio-only files');
  const videoS = withVideo[0]?.info.durationS ?? 0;
  if (!(videoS > switchedS)) {
    throw new Error(`the video file (${videoS} s) does not reach the switch (${switchedS} s in)`);
  }
  // The audio-only recording starts where the video one stopped: the outage is in the files.
  const gapS = (nextStartedAt - firstStartedAt) / 1000 - videoS;
  console.log(`  between the two files: ${gapS.toFixed(2)} s`);
  if (gapS > 3) throw new Error(`${gapS.toFixed(1)} s of the meeting are in neither file`);
  await page.close();
}

export const registration = {
  name: '33',
  after: '68',
  scenario: scenarioBacklogFull,
} satisfies ScenarioRegistration;
