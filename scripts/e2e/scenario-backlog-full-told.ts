/**
 * E2e scenario 51, run against every provider's fixture page like the ones in `scenarios.ts`: the
 * store refuses every chunk, as on a full disk, until the meeting page holds its limit.
 *   - With video: the recording goes on audio only, and that tab's status card says so in a state
 *     that lasts, beside one toast; another meeting tab says nothing. Once storing works again
 *     and the page has handed the video over, the state clears and the video comes back.
 *   - Then audio alone (video off in the settings), the page's limit lowered again: the page
 *     stops recording once it holds
 *     its limit, and the card says that nothing records, instead of "Saving…", until the
 *     extension has taken it; then the state clears and the recording goes on by itself.
 * Every recording is saved whole.
 */
import path from 'node:path';
import type { Page } from 'puppeteer';
import { z } from 'zod';
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
  overlayState,
  pageDiagnostics,
  pressCardButton,
  probe,
  sleep,
  toastsOf,
  waitFor,
  waitForCompleteFile,
  watchToasts,
} from './harness';
import type { ScenarioContext } from './scenarios';
import { meetingUrl } from './targets';

/** The page's limit while it records video: filled within half a minute of the fixture's video. */
const VIDEO_LIMIT_BYTES = 2 ** 20;
/** The page's limit for the audio-only recording of the second part: about 8 s of audio. */
const AUDIO_LIMIT_BYTES = 64 * 2 ** 10;
/** How long the second part keeps the store refusing once the page has stopped recording. */
const HOLD_WHILE_WAITING_MS = 5_000;
/** The words of the toasts that say the video stopped, and that nothing records. */
const VIDEO_STOPPED = 'the video stopped';
const NOTHING_RECORDS = 'nothing records';

const recordingsSchema = z.object({
  recordings: z.array(z.object({ id: z.string(), status: z.string(), chunkCount: z.number() })),
});
const armedSchema = z.object({ armed: z.literal(true) });
const restoredSchema = z.object({ failed: z.number() });
const pageSchema = z.object({
  state: z.string(),
  recordingId: z.string().nullable(),
  // Absent from builds that do not report it.
  backlogFull: z.string().optional(),
});
const cardSchema = z.object({
  state: z.string(),
  status: z.string(),
  alert: z.string(),
  label: z.string(),
  labelShown: z.boolean(),
});
type Card = z.infer<typeof cardSchema>;

/** What the status card shows, read from its shadow root. */
async function readCard(page: Page): Promise<Card> {
  return cardSchema.parse(
    await page.evaluate(() => {
      const card = window.__fixture.cardRoot()?.querySelector('.zr-card');
      if (!(card instanceof HTMLElement)) throw new Error('no status card');
      const label = card.querySelector('.zr-alert');
      return {
        state: card.dataset['state'] ?? '',
        status: card.querySelector('.zr-status')?.textContent ?? '',
        alert: card.dataset['alert'] ?? '',
        label: label?.textContent ?? '',
        labelShown: label instanceof HTMLElement && label.checkVisibility(),
      };
    }),
  );
}

const describeCard = (card: Card): string =>
  `${card.state} "${card.status}", alert ${card.alert || 'none'}${card.labelShown ? ` "${card.label}"` : ''}`;

const readPage = async (page: Page) =>
  pageSchema.parse(await page.evaluate(() => window.__zenRecorderPage?.snapshot()));

const errorToasts = async (page: Page, words: string) =>
  (await toastsOf(page)).filter((toast) => toast.kind === 'error' && toast.text.includes(words));

const storedRecording = async (page: Page, id: string) =>
  recordingsSchema
    .parse(await probe(page, 'background:state'))
    .recordings.find((recording) => recording.id === id);

async function setLimit(page: Page, bytes: number): Promise<void> {
  const limit = await page.evaluate(
    (value) => window.__zenRecorderPage?.setBacklogLimit?.(value) ?? null,
    bytes,
  );
  if (limit?.backlogLimitBytes !== bytes) {
    throw new Error("this build cannot lower the page's backlog limit");
  }
}

/** Waits for the card to show `alert`, and says what it showed when it does not. */
async function waitForAlert(page: Page, alert: string, timeoutMs: number): Promise<Card> {
  let last: Card | null = null;
  return waitFor(
    `the card to say ${alert || 'nothing is full'}`,
    async () => {
      last = await readCard(page);
      return last.alert === alert ? last : null;
    },
    timeoutMs,
  ).catch((error: unknown) => {
    console.log(`  the card: ${last ? describeCard(last) : 'unread'}`);
    throw error;
  });
}

/** The store works again; returns how many chunk sends it refused. */
async function restore(page: Page): Promise<number> {
  return restoredSchema.parse(await probe(page, 'store:restore-chunks')).failed;
}

/**
 * The first part: video, then the store refuses every chunk until the page holds its limit.
 * Returns the video recording and the audio-only one that follows it.
 */
async function videoStops(page: Page, idle: Page): Promise<[string, string, string]> {
  await setLimit(page, VIDEO_LIMIT_BYTES);
  await page.click('#start');
  const first = await waitFor('recording', () => currentRecordingId(page), 20_000);
  await waitFor(
    'the first chunk stored',
    async () => (await storedRecording(page, first))?.chunkCount,
    15_000,
  );
  armedSchema.parse(await probe(page, 'store:fail-chunks'));
  const failedAt = Date.now();
  const second = await waitFor(
    'an audio-only recording once the video filled the page',
    async () => {
      const { recordingId } = await readPage(page);
      return recordingId !== null && recordingId !== first ? recordingId : null;
    },
    120_000,
  );
  const switchedAt = Date.now();
  console.log(
    `  ${((switchedAt - failedAt) / 1000).toFixed(1)} s after the store refused every chunk: audio only (${second}), the page reports ${(await readPage(page)).backlogFull ?? 'nothing'}`,
  );
  const card = await waitForAlert(page, 'audio-only', 3_000);
  console.log(
    `  ${((Date.now() - switchedAt) / 1000).toFixed(1)} s later the card says: ${describeCard(card)}`,
  );
  expectEqual(card.labelShown && card.label, 'Audio only', 'the compact card');
  expectEqual(
    (await errorToasts(page, VIDEO_STOPPED)).length,
    1,
    'toasts saying the video stopped',
  );
  // The state lasts: it is no toast that leaves.
  await sleep(9_000);
  expectEqual((await readCard(page)).alert, 'audio-only', 'the card 9 s later');
  expectEqual((await readCard(idle)).alert, '', 'the idle tab');
  console.log(`  the store works again (${await restore(page)} chunk sends refused)`);
  const restoredAt = Date.now();
  await waitForAlert(page, '', 60_000);
  console.log(
    `  ${((Date.now() - restoredAt) / 1000).toFixed(1)} s later the card says: ${describeCard(await readCard(page))}`,
  );
  // The extension took the video and keeps up with the audio-only recording: the video is back.
  const back = await waitFor(
    'a recording with video again',
    async () => {
      const id = await currentRecordingId(page);
      return id !== null && id !== second ? id : null;
    },
    30_000,
  );
  console.log(`  the video is back: ${back}`);
  return [first, second, back];
}

/**
 * The second part: audio alone under a small limit, then the store refuses every chunk until the
 * page holds it. Returns the recording that filled it and the one that starts once it is taken.
 */
async function audioWaits(page: Page, running: string): Promise<[string, string]> {
  // A Stop before a recording's first sample saves nothing (no header, no track), and the muxer
  // writes a first chunk only once every track has a sample: wait for it.
  await waitFor(
    'the first chunk of the recording with video',
    async () => (await storedRecording(page, running))?.chunkCount,
    15_000,
  );
  console.log(`  video off: ${JSON.stringify(await probe(page, 'settings:video-off'))}`);
  await setLimit(page, AUDIO_LIMIT_BYTES);
  await pressCardButton(page, 'Stop');
  // Record pressed while the stop is still under way would be ignored.
  await waitFor(
    'stopped',
    async () => ['waiting', 'idle'].includes((await overlayState(page)) ?? ''),
    20_000,
  );
  await pressCardButton(page, 'Record');
  const third = await waitFor(
    'an audio-only recording under the small limit',
    async () => {
      const id = await currentRecordingId(page);
      return id !== null && id !== running ? id : null;
    },
    20_000,
  );
  await waitFor(
    'its first chunk stored',
    async () => (await storedRecording(page, third))?.chunkCount,
    15_000,
  );
  armedSchema.parse(await probe(page, 'store:fail-chunks'));
  const card = await waitForAlert(page, 'waiting', 60_000);
  console.log(`  the page holds its audio limit; the card says: ${describeCard(card)}`);
  expectEqual(card.labelShown && card.label, 'Waiting for space', 'the compact card');
  expectEqual(card.status, 'Not recording', 'the status in words');
  expectEqual((await errorToasts(page, NOTHING_RECORDS)).length, 1, 'toasts saying it waits');
  await sleep(HOLD_WHILE_WAITING_MS);
  const waiting = await readPage(page);
  expectEqual(waiting.recordingId, null, `recording ${HOLD_WHILE_WAITING_MS / 1000} s later`);
  expectEqual((await readCard(page)).alert, 'waiting', 'the card while nothing records');
  console.log(`  the store works again (${await restore(page)} chunk sends refused)`);
  const restoredAt = Date.now();
  const cleared = await waitForAlert(page, '', 60_000);
  const fourth = await waitFor('the next recording', () => currentRecordingId(page), 10_000);
  console.log(
    `  ${((Date.now() - restoredAt) / 1000).toFixed(1)} s later the card says: ${describeCard(cleared)}; recording ${fourth}`,
  );
  return [third, fourth];
}

/**
 * Hangs up, then checks that every recording was saved with every chunk the page recorded: the
 * page's "recording ended" lines since `since`, in the order the recordings ran.
 */
async function savedWhole(page: Page, before: ReadonlySet<string>, ids: string[], since: number) {
  await page.evaluate(() => window.__fixture.hangup());
  const files = await waitFor(
    `${ids.length} saved files`,
    async () => {
      const saved = await newRecordings(before);
      return saved.length >= ids.length ? saved : null;
    },
    90_000,
  );
  const pageLines = await pageDiagnostics(page, since);
  const backgroundLines = (await backgroundDiagnostics(page)).filter((line) =>
    [...ids, ...files.map((file) => path.basename(file))].some((part) => line.includes(part)),
  );
  for (const line of [...pageLines, ...backgroundLines].sort()) {
    if (/backlog full|recording ended|saved/.test(line)) console.log(`  diagnostics: ${line}`);
  }
  const ended = pageLines.filter((line) => line.includes('recording ended'));
  for (const [index, id] of ids.entries()) {
    const counted = ended[index]?.match(/after (\d+) chunks/)?.[1] ?? 'none';
    const stored = await waitFor(
      `${id} saved`,
      async () => {
        const recording = await storedRecording(page, id);
        return recording?.status === 'saved' ? recording : null;
      },
      30_000,
    );
    expectEqual(String(stored.chunkCount), counted, `chunks stored for ${id}`);
  }
  for (const file of files) {
    const info = await inspectWebm(await waitForCompleteFile(file));
    console.log(`  file: ${path.basename(file)} → ${describeWebm(info)}`);
    console.log(`    ffprobe: ${ffprobe(file)}`);
  }
  const gap = backgroundLines.find((line) => line.includes('chunk sequence gap'));
  if (gap) throw new Error(`a chunk is missing from a file: ${gap}`);
}

export async function scenarioBacklogFullTold({ browser, target }: ScenarioContext): Promise<void> {
  console.log(
    `▶ ${target.id} scenario 51: the store refuses every chunk until the page holds its limit → the recording tab's card says audio only, then nothing records, each beside one toast; another tab says nothing; both clear once storing works`,
  );
  const before = new Set(await listWebm());
  const since = Date.now();
  // The idle tab first: the recording tab must be in front (Firefox defers device lists in a
  // background tab).
  const idle = await openMeeting(browser, meetingUrl(target));
  const page = await openMeeting(browser, meetingUrl(target));
  await watchToasts(idle);
  await watchToasts(page);
  try {
    const [first, second, back] = await videoStops(page, idle);
    const [third, fourth] = await audioWaits(page, back);
    for (const toast of await toastsOf(page)) console.log(`  toast (${toast.kind}): ${toast.text}`);
    const told = [VIDEO_STOPPED, NOTHING_RECORDS].map(async (words) => errorToasts(idle, words));
    expectEqual((await Promise.all(told)).flat().length, 0, 'toasts in the idle tab');
    expectEqual((await readCard(idle)).alert, '', 'the idle tab');
    await savedWhole(page, before, [first, second, back, third, fourth], since);
  } finally {
    // The store works again, with video, for the scenarios after this one, whatever failed.
    await restore(page);
    await probe(page, 'settings:video-on');
  }
  await page.close();
  await idle.close();
}
