/**
 * E2e scenario 37, run against every provider's fixture page: the video encoder fails while the
 * extension takes no chunk → the audio-only recording starts at once, beside the failed recording's
 * chunks still waiting in the page, and when the extension is back both files are saved whole.
 */
import path from 'node:path';
import { z } from 'zod';
import {
  backgroundDiagnostics,
  describeWebm,
  expectEqual,
  failVideoEncoder,
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

const pageStateSchema = z.object({
  id: z.string().nullable(),
  debug: z.object({
    video: z.unknown().nullable(),
    backlog: z.object({ bytes: z.number(), chunks: z.number() }).nullable(),
  }),
});

/** How long scenario 37 keeps the store held after the video fails. */
const HOLD_AFTER_VIDEO_ERROR_MS = 15_000;

/** The longest the audio-only recording may take to start after the video fails. */
const MAX_SWITCH_S = 3;

export async function scenarioVideoErrorDuringOutage({
  browser,
  target,
}: ScenarioContext): Promise<void> {
  console.log(
    `▶ ${target.id} scenario 37: the video encoder fails while the extension takes no chunk → audio only at once, both files whole`,
  );
  const before = new Set(await listWebm());
  const since = Date.now();
  const page = await openMeeting(browser, meetingUrl(target));
  await page.click('#start');
  const readPage = async () =>
    pageStateSchema.parse(
      await page.evaluate(() => ({
        id: window.__zenRecorderPage?.snapshot().recordingId ?? null,
        debug: window.__zenRecorderPage?.debug(),
      })),
    );
  const first = await waitFor(
    'a recording with video',
    async () => {
      const state = await readPage();
      return state.debug.video !== null ? state.id : null;
    },
    20_000,
  );
  const firstStartedAt = await recordingStartedAt(page);
  const recordings = () => storedRecordings(page);
  const stored = async (id: string) => (await recordings()).find((r) => r.id === id);
  await waitFor('the first chunk stored', async () => (await stored(first))?.chunkCount, 15_000);
  // The store stops answering: the tab's chunks wait in the page, as they do while the
  // background restarts or the disk is full.
  console.log(`  hold the store: ${JSON.stringify(await probe(page, 'store:hold-next-chunk'))}`);
  await sleep(4_000);
  const held = await readPage();
  console.log(`  video backlog before the error: ${JSON.stringify(held.debug.backlog)}`);
  const failedAt = await failVideoEncoder(page, 'injected by the e2e run');
  const heldUntil = Date.now() + HOLD_AFTER_VIDEO_ERROR_MS;
  const audioOnly = async () => {
    const state = await readPage();
    return state.id !== null && state.id !== first && state.debug.video === null ? state.id : null;
  };
  const duringHold = await waitFor(
    'an audio-only recording while the store holds',
    audioOnly,
    HOLD_AFTER_VIDEO_ERROR_MS,
  ).catch(() => null);
  await sleep(Math.max(0, heldUntil - Date.now()));
  const audio = await readPage();
  console.log(
    `  ${HOLD_AFTER_VIDEO_ERROR_MS / 1000} s after the error, the store still held: recording ${audio.id ?? 'none'}, backlog ${JSON.stringify(audio.debug.backlog)}`,
  );
  console.log(`  release the store: ${JSON.stringify(await probe(page, 'store:release-chunks'))}`);
  const next = duringHold ?? (await waitFor('an audio-only recording', audioOnly, 60_000));
  const switchS = ((await recordingStartedAt(page)) - failedAt) / 1000;
  console.log(
    `  the audio-only recording ${next} started ${switchS.toFixed(2)} s after the video error, ${duringHold ? 'while the store held' : 'only once the store was released'}`,
  );
  await waitFor(
    `${first} saved`,
    async () => (await stored(first))?.status === 'saved',
    60_000,
  ).catch(async (error: unknown) => {
    console.log(`  background: ${JSON.stringify(await recordings())}`);
    throw error;
  });
  await sleep(4_000);
  await page.evaluate(() => window.__fixture.hangup());
  const files = await waitFor(
    'two saved files',
    async () => {
      const saved = await newRecordings(before);
      return saved.length >= 2 ? saved : null;
    },
    60_000,
  );
  await sleep(2_000);
  const pageLines = await pageDiagnostics(page, since);
  const backgroundLines = (await backgroundDiagnostics(page)).filter((line) =>
    [first, next, ...files.map((file) => path.basename(file))].some((part) => line.includes(part)),
  );
  for (const line of [...pageLines, ...backgroundLines].sort()) {
    if (/video encoder error|recording (started|ended)|saved|gap|could not/.test(line))
      console.log(`  diagnostics: ${line}`);
  }
  if (!pageLines.some((line) => line.includes('video encoder error: injected by the e2e run'))) {
    throw new Error('Diagnostics do not say that the video encoder failed');
  }
  const gap = backgroundLines.find((line) => line.includes('chunk sequence gap'));
  if (gap) throw new Error(`a chunk is missing from a file: ${gap}`);
  // The page's two "recording ended" lines, in order: the video recording's, then the audio one's.
  const ended = pageLines.filter((line) => line.includes('recording ended'));
  if (!ended[0]?.includes('recording ended (encoder-error)')) {
    throw new Error(`the video recording did not end as encoder-error: ${ended[0]}`);
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
  const audioOnlyFiles = infos.filter(({ info }) => info.video === null && info.tracks === 1);
  expectEqual(withVideo.length, 1, 'files with video');
  expectEqual(audioOnlyFiles.length, 1, 'audio-only files');
  const videoS = withVideo[0]?.info.durationS ?? 0;
  const failedS = (failedAt - firstStartedAt) / 1000;
  console.log(`  video file ${videoS.toFixed(2)} s, video error ${failedS.toFixed(2)} s in`);
  if (Math.abs(videoS - failedS) > MAX_SWITCH_S) {
    throw new Error(`the video file (${videoS} s) does not end at the error (${failedS} s in)`);
  }
  // The meeting between the video error and the audio-only recording is in neither file.
  if (switchS > MAX_SWITCH_S) {
    throw new Error(
      `the audio-only recording started ${switchS.toFixed(1)} s after the video error: nothing was recorded in between`,
    );
  }
  await page.close();
}

export const registration = {
  name: '37',
  after: '62',
  scenario: scenarioVideoErrorDuringOutage,
} satisfies ScenarioRegistration;
