/**
 * E2e scenario 40, run against every provider's fixture page like the ones in `scenarios.ts`: the
 * audio encoder fails while the extension takes no chunk (the store held, as on a full disk) → the
 * next recording starts at once, beside the failed one's chunks still waiting in the page; the
 * page's audio limit counts both, so the next one stops once they fill it, nothing records while
 * the page holds that limit, the third starts once the extension has taken them, and every file is
 * saved whole.
 */
import { stat } from 'node:fs/promises';
import path from 'node:path';
import type { Page } from 'puppeteer';
import { z } from 'zod';
import {
  backgroundDiagnostics,
  currentRecordingId,
  describeWebm,
  expectEqual,
  failLastMediaRecorder,
  ffprobe,
  inspectWebm,
  listWebm,
  newRecordings,
  openMeeting,
  pageDiagnostics,
  probe,
  recordingStartedAt,
  sleep,
  trackMediaRecorders,
  waitFor,
  waitForCompleteFile,
} from './harness';
import type { ScenarioContext } from './scenarios';
import { meetingUrl } from './targets';

const videoModeSchema = z.object({ videoMode: z.string() });
const recordingStateSchema = z.object({
  recordings: z.array(
    z.object({ id: z.string(), status: z.string(), chunkCount: z.number(), byteSize: z.number() }),
  ),
});
/** The longest the next recording may take to start after the encoder fails. */
const MAX_SWITCH_S = 3;

/**
 * The page's backlog limit in scenario 40: the first recording holds a fifth of it when its
 * encoder fails, and the next one fills the rest in about 15 s of audio.
 */
const AUDIO_BACKLOG_BYTES = 128 * 2 ** 10;
/** How long scenario 40 keeps the store held once the page holds its whole audio limit. */
const HOLD_WHILE_FULL_MS = 6_000;

const audioPageSchema = z.object({
  state: z.string(),
  id: z.string().nullable(),
  startedAt: z.number().nullable(),
  debug: z.object({
    backlog: z.object({ bytes: z.number(), chunks: z.number() }).nullable(),
    // The unacked bytes of the page's stopped recordings, by kind (absent from older builds).
    stoppedBacklog: z.object({ withVideo: z.number(), audioOnly: z.number() }).optional(),
  }),
});
type AudioPageState = z.infer<typeof audioPageSchema>;

const readAudioPage = async (page: Page): Promise<AudioPageState> =>
  audioPageSchema.parse(
    await page.evaluate(() => {
      const snapshot = window.__zenRecorderPage?.snapshot();
      return {
        state: snapshot?.state,
        id: snapshot?.recordingId ?? null,
        startedAt: snapshot?.recordingStartedAt ?? null,
        debug: window.__zenRecorderPage?.debug(),
      };
    }),
  );

/**
 * Follows the recording that started beside the failed one's chunks until the page's audio
 * backlog, both recordings together, passes the limit and stops it. Returns the most the page
 * held while it ran; throws when a third recording starts while the store still holds.
 */
async function waitForFullAudioBacklog(page: Page, second: string): Promise<number> {
  let peak = 0;
  await waitFor(
    'the page to hold its audio limit and stop the second recording',
    async () => {
      const state = await readAudioPage(page);
      // While it runs, the page holds its backlog and the failed recording's.
      const held = (state.debug.backlog?.bytes ?? 0) + (state.debug.stoppedBacklog?.audioOnly ?? 0);
      if (state.id === second) peak = Math.max(peak, held);
      return state.id === null && state.state === 'stopping';
    },
    90_000,
  );
  console.log(`  the page stopped ${second}: its audio backlog peaked at ${peak} bytes before`);
  await sleep(HOLD_WHILE_FULL_MS);
  const waiting = await readAudioPage(page);
  console.log(
    `  ${HOLD_WHILE_FULL_MS / 1000} s later, the store still held: ${waiting.state}, recording ${waiting.id ?? 'none'}, stopped recordings hold ${JSON.stringify(waiting.debug.stoppedBacklog)}`,
  );
  if (waiting.id !== null) {
    throw new Error(`a recording started while the page held its whole audio limit: ${waiting.id}`);
  }
  return peak;
}

const storedRecording = async (page: Page, id: string) =>
  recordingStateSchema
    .parse(await probe(page, 'background:state'))
    .recordings.find((recording) => recording.id === id);

/** Audio only, the page's limit lowered, the MediaRecorders tracked: the first recording. */
async function startAudioOnly(page: Page): Promise<{ first: string; startedAt: number }> {
  const result = videoModeSchema.safeParse(await probe(page, 'settings:video-off'));
  if (!result.success || result.data.videoMode !== 'off') {
    throw new Error('could not switch video off through the debug probe');
  }
  const limit = await page.evaluate(
    (bytes) => window.__zenRecorderPage?.setBacklogLimit?.(bytes) ?? null,
    AUDIO_BACKLOG_BYTES,
  );
  if (limit?.backlogLimitBytes !== AUDIO_BACKLOG_BYTES) {
    throw new Error("this build cannot lower the page's backlog limit");
  }
  await trackMediaRecorders(page);
  await page.click('#start');
  const first = await waitFor('first recording', () => currentRecordingId(page), 20_000);
  const startedAt = await recordingStartedAt(page);
  await waitFor(
    'the first chunk stored',
    async () => (await storedRecording(page, first))?.chunkCount,
    15_000,
  );
  return { first, startedAt };
}

/**
 * Holds the store, makes the MediaRecorder fail 4 s later, follows the page while the store holds,
 * then releases it. Returns the next recording, when it started and how long after the error,
 * whether it started while the store held, and the most the page held of audio while it ran.
 */
async function failDuringOutage(page: Page, first: string) {
  // The store stops answering: the tab's chunks wait in the page, as they do on a full disk.
  console.log(`  hold the store: ${JSON.stringify(await probe(page, 'store:hold-next-chunk'))}`);
  await sleep(4_000);
  console.log(
    `  backlog before the error: ${JSON.stringify((await readAudioPage(page)).debug.backlog)}`,
  );
  await failLastMediaRecorder(page, 'injected by the e2e run');
  const failedAt = Date.now();
  const nextRecording = async () => {
    const { id, startedAt } = await readAudioPage(page);
    return id !== null && id !== first ? { id, startedAt: startedAt ?? 0 } : null;
  };
  const duringHold = await waitFor(
    'a new recording while the store holds',
    nextRecording,
    15_000,
  ).catch(() => null);
  const peak = duringHold ? await waitForFullAudioBacklog(page, duringHold.id) : null;
  if (!duringHold) console.log('  no new recording while the store held');
  console.log(`  release the store: ${JSON.stringify(await probe(page, 'store:release-chunks'))}`);
  const next = duringHold ?? (await waitFor('a new recording', nextRecording, 60_000));
  const switchS = (next.startedAt - failedAt) / 1000;
  console.log(
    `  the next recording ${next.id} started ${switchS.toFixed(2)} s after the encoder error, ${duringHold ? 'while the store held' : 'only once the store was released'}`,
  );
  return { second: next.id, startedAt: next.startedAt, switchS, peak, held: duringHold !== null };
}

/**
 * Once the extension is back: the third recording when the page waited for room, every earlier
 * one saved, then the hangup. Returns the recordings in order and the files saved.
 */
async function saveAll(
  page: Page,
  before: ReadonlySet<string>,
  earlier: string[],
  waited: boolean,
) {
  const ids = waited
    ? [
        ...earlier,
        await waitFor(
          'a third recording once the extension took the backlog',
          async () => {
            const { id } = await readAudioPage(page);
            return id !== null && !earlier.includes(id) ? id : null;
          },
          60_000,
        ),
      ]
    : earlier;
  for (const id of ids.slice(0, -1)) {
    await waitFor(
      `${id} saved`,
      async () => (await storedRecording(page, id))?.status === 'saved',
      60_000,
    );
  }
  await sleep(4_000);
  await page.evaluate(() => window.__fixture.hangup());
  const files = await waitFor(
    `${ids.length} saved files`,
    async () => {
      const saved = await newRecordings(before);
      return saved.length >= ids.length ? saved : null;
    },
    60_000,
  );
  return { ids, files };
}

/**
 * Prints Diagnostics and the files, and checks that no chunk is missing and that every file is
 * audio only. Returns the page's "recording ended" lines in order and the failed file's length.
 */
async function checkFiles(page: Page, since: number, ids: string[], files: string[]) {
  await sleep(2_000);
  const pageLines = await pageDiagnostics(page, since);
  const backgroundLines = (await backgroundDiagnostics(page)).filter((line) =>
    [...ids, ...files.map((file) => path.basename(file))].some((part) => line.includes(part)),
  );
  for (const line of [...pageLines, ...backgroundLines].sort()) {
    if (/encoder error|backlog|recording (started|ended)|saved|gap|could not/.test(line))
      console.log(`  diagnostics: ${line}`);
  }
  const gap = backgroundLines.find((line) => line.includes('chunk sequence gap'));
  if (gap) throw new Error(`a chunk is missing from a file: ${gap}`);
  const ended = pageLines.filter((line) => line.includes('recording ended'));
  if (!ended[0]?.includes('recording ended (encoder-error)')) {
    throw new Error(`the first recording did not end as encoder-error: ${ended[0]}`);
  }
  // Every chunk the page recorded is in its file.
  for (const [index, id] of ids.entries()) {
    const sent = ended[index]?.match(/after (\d+) chunks/)?.[1] ?? 'none';
    expectEqual(
      String((await storedRecording(page, id))?.chunkCount),
      sent,
      `chunks stored for ${id}`,
    );
  }
  const infos = await Promise.all(
    files.map(async (file) => ({ file, info: await inspectWebm(await waitForCompleteFile(file)) })),
  );
  for (const { file, info } of infos) {
    console.log(`  file: ${path.basename(file)} → ${describeWebm(info)}`);
    console.log(`    ffprobe: ${ffprobe(file)}`);
    if (info.tracks !== 1 || info.video) throw new Error('expected an audio-only file');
  }
  expectEqual(infos.length, ids.length, 'files saved');
  // A saved recording's size is its file's: that tells the failed recording's file apart.
  const firstBytes = (await storedRecording(page, ids[0] ?? ''))?.byteSize;
  const sizes = await Promise.all(infos.map(async ({ file }) => (await stat(file)).size));
  return { ended, pageLines, firstS: infos[sizes.indexOf(firstBytes ?? -1)]?.info.durationS ?? 0 };
}

export async function scenarioAudioErrorDuringOutage({
  browser,
  target,
}: ScenarioContext): Promise<void> {
  console.log(
    `▶ ${target.id} scenario 40: the audio encoder fails while the extension takes no chunk → the next recording starts at once, the page holds its limit across both, every chunk saved`,
  );
  const before = new Set(await listWebm());
  const since = Date.now();
  const page = await openMeeting(browser, meetingUrl(target));
  try {
    const { first, startedAt } = await startAudioOnly(page);
    const outage = await failDuringOutage(page, first);
    const { ids, files } = await saveAll(page, before, [first, outage.second], outage.held);
    const { ended, pageLines, firstS } = await checkFiles(page, since, ids, files);
    const betweenS = (outage.startedAt - startedAt) / 1000 - firstS;
    console.log(
      `  failed file ${firstS.toFixed(2)} s; between it and the next: ${betweenS.toFixed(2)} s`,
    );
    if (outage.switchS > MAX_SWITCH_S || betweenS > MAX_SWITCH_S) {
      throw new Error(
        `the next recording started ${outage.switchS.toFixed(1)} s after the encoder error: ${betweenS.toFixed(1)} s of the meeting are in no file`,
      );
    }
    const full = pageLines.find(
      (line) => line.includes('backlog full:') && line.includes(outage.second),
    );
    if (!full?.includes('of earlier recordings')) {
      throw new Error(
        `Diagnostics do not say that the earlier recording's chunks filled the limit: ${full}`,
      );
    }
    if (!ended[1]?.includes('recording ended (backlog-full)')) {
      throw new Error(`the second recording did not end as backlog-full: ${ended[1]}`);
    }
    if (outage.peak === null || outage.peak > AUDIO_BACKLOG_BYTES) {
      throw new Error(
        `the page held ${outage.peak} bytes of audio, more than its limit of ${AUDIO_BACKLOG_BYTES}`,
      );
    }
  } finally {
    await probe(page, 'store:release-chunks');
    await probe(page, 'settings:video-on');
  }
  await page.close();
}
