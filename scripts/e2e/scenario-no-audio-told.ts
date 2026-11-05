/**
 * E2e scenario 104, run against every provider's fixture page: a recording with video whose audio
 * has not started a few seconds in says so, in the tab and on the toolbar, and stops saying it once
 * the audio starts.
 *
 * The recording's audio comes from the recorder's own `AudioContext`, and Firefox runs a context
 * only once it can open an audio output: with no output device, or a sound server that is stuck,
 * every context stays suspended. The video records on, and nothing told the person recording that
 * the file would have no sound; the status card, the popup and the badge said "Recording".
 *
 *   - Before the call, `window.AudioContext` is a subclass that suspends itself and ignores
 *     `resume()` until the scenario lets it go, as such a browser holds every context. Record.
 *   - A few seconds in: the page's snapshot says the audio is missing; one Diagnostics line says
 *     the audio has not started; the status card still says "Recording", with "No audio" beside
 *     it and what to do in its details, and one toast; the popup's card for the tab says the
 *     same, and the toolbar badge shows ! with those words in its title. The extension has stored
 *     only the file's header meanwhile: the page holds the video until every track has a sample.
 *   - The scenario lets the contexts go: the audio starts, Diagnostics say so, the card, the
 *     snapshot and the badge stop saying it, and a Stop saves a file with video and audio.
 *
 * Every check is made and reported before the scenario fails, so one run of an older build shows
 * each thing it gets wrong.
 */
import path from 'node:path';
import type { Page } from 'puppeteer';
import { z } from 'zod';
import {
  currentRecordingId,
  describeWebm,
  inspectWebm,
  listWebm,
  openMeeting,
  pageDiagnostics,
  pressCardButton,
  probe,
  readBadge,
  sleep,
  storedRecording,
  toastsOf,
  waitFor,
  waitForNewRecording,
  watchToasts,
} from './harness';
import type { ScenarioContext, ScenarioRegistration } from './order-scenarios';
import { readStatusCard } from './read-status-card';
import { meetingUrl } from './targets';
import { waitForEveryTrack } from './wait-for-every-track';

declare global {
  interface Window {
    /** Lets every audio context the page made since the hold run, as an audio output would. */
    __e2eReleaseAudio?: () => void;
  }
}

/** The words of the Diagnostics line, the card, the toast, the popup and the badge's title. */
const LINE = /the audio has not started/;
const STARTS = /audio starts [\d.]+ s into the recording/;
const LABEL = 'No audio';
const WHAT_TO_DO = 'sound output';
const BADGE_TITLE = 'Zen Recorder: no audio.';
/** The page says it 5 s into the file; a slow runner's ticks and the start take some more. */
const WARNING_MS = 15_000;
/** The popup and the badge follow the snapshot the background got last, seconds behind the page. */
const FOLLOW_MS = 20_000;

const videoModeSchema = z.object({ videoMode: z.string() });
const pageSchema = z.object({
  state: z.string(),
  recordingId: z.string().nullable(),
  // Absent from builds that do not report it, and while the audio runs.
  noAudio: z.boolean().optional(),
});
const popupSchema = z.object({ cards: z.array(z.string()) });

const readPage = async (page: Page) =>
  pageSchema.parse(await page.evaluate(() => window.__zenRecorderPage?.snapshot()));

/**
 * Every audio context the page makes from now on stays suspended, as in a browser that can open no
 * audio output, until `__e2eReleaseAudio` lets them go. The class is anonymous, and no function is
 * declared inside `evaluate`: the e2e run's compiler names them with a helper the page lacks.
 */
async function holdAudio(page: Page): Promise<void> {
  await page.evaluate(() => {
    const Original = window.AudioContext;
    const held: AudioContext[] = [];
    const hold = { on: true };
    window.AudioContext = class extends Original {
      constructor(options?: AudioContextOptions) {
        super(options);
        held.push(this);
        void this.suspend();
      }
      override resume(): Promise<void> {
        return hold.on ? Promise.resolve() : super.resume();
      }
    };
    window.__e2eReleaseAudio = () => {
      hold.on = false;
      for (const context of held) void Original.prototype.resume.call(context);
    };
  });
}

/** The page's Diagnostics lines from `since` on that match `pattern`. */
const linesMatching = async (page: Page, since: number, pattern: RegExp): Promise<string[]> =>
  (await pageDiagnostics(page, since)).filter((line) => pattern.test(line));

/** Reads `read` until `done` holds, for up to `ms`; the last reading either way. */
async function readUntil<T>(
  label: string,
  read: () => Promise<T>,
  done: (value: T) => boolean,
  ms: number,
): Promise<T> {
  return waitFor(
    label,
    async () => {
      const value = await read();
      return done(value) ? value : null;
    },
    ms,
  ).catch(read);
}

/** What the card, its toast, the popup and the badge say while the audio has not started. */
async function checkWarned(page: Page, problems: string[]): Promise<void> {
  const card = await readStatusCard(page);
  console.log(`  status card: "${card.status}" "${card.alert}": ${card.notice}`);
  if (card.status !== 'Recording' || card.alert !== LABEL) {
    problems.push(`the status card says "${card.status}" "${card.alert}"`);
  }
  if (!card.notice.includes(WHAT_TO_DO))
    problems.push('its details do not say to check the sound output');
  const toasts = await toastsOf(page);
  for (const toast of toasts) console.log(`  toast (${toast.kind}): ${toast.text}`);
  if (toasts.filter((toast) => toast.text.includes(WHAT_TO_DO)).length !== 1) {
    problems.push(`${toasts.length} toasts, not one that says to check the sound output`);
  }
  const saysIt = (text: string) => text.includes(`${LABEL}.`) && text.includes(WHAT_TO_DO);
  const popup = await readUntil(
    'the popup',
    async () => popupSchema.parse(await probe(page, 'popup:cards')).cards,
    (cards) => cards.some(saysIt),
    FOLLOW_MS,
  );
  for (const text of popup) console.log(`  popup card: ${text}`);
  if (!popup.some(saysIt)) problems.push('no popup card says the audio is missing');
  const badge = await readUntil(
    'the badge',
    () => readBadge(page),
    (read) => read.text === '!' && read.title.startsWith(BADGE_TITLE),
    FOLLOW_MS,
  );
  console.log(`  badge: "${badge.text}", title "${badge.title}"`);
  if (badge.text !== '!' || !badge.title.startsWith(BADGE_TITLE)) {
    problems.push(`the badge shows "${badge.text}", title "${badge.title}"`);
  }
}

/** The audio starts: Diagnostics say so, and the snapshot, the card and the badge stop warning. */
async function checkCleared(page: Page, since: number, problems: string[]): Promise<void> {
  const starts = await readUntil(
    'the line saying the audio starts',
    () => linesMatching(page, since, STARTS),
    (lines) => lines.length > 0,
    10_000,
  );
  for (const line of starts) console.log(`  diagnostics: ${line}`);
  if (starts.length !== 1) problems.push(`${starts.length} lines say the audio starts, not 1`);
  const snapshot = await readUntil(
    'the snapshot to clear',
    () => readPage(page),
    (read) => read.noAudio !== true,
    5_000,
  );
  if (snapshot.noAudio === true) problems.push('the snapshot still says the audio is missing');
  const card = await readUntil(
    'the card to clear',
    () => readStatusCard(page),
    (read) => read.alert === '',
    5_000,
  );
  console.log(`  once the audio runs: the card says "${card.status}" "${card.alert}"`);
  if (card.alert !== '') problems.push(`the card still says "${card.alert}"`);
  const badge = await readUntil(
    'the badge to clear',
    () => readBadge(page),
    (read) => read.text !== '!',
    FOLLOW_MS,
  );
  console.log(`  badge: "${badge.text}", title "${badge.title}"`);
  if (badge.text === '!') problems.push(`the badge still shows "!", title "${badge.title}"`);
}

/** Records with the audio held, checks the warning, lets the audio go, checks it clears. */
async function recordWithoutAudio(page: Page, since: number, problems: string[]): Promise<string> {
  const id = await waitFor('the recording', () => currentRecordingId(page), 20_000);
  const startedAt = Date.now();
  const warned = await readUntil(
    'the snapshot to say the audio is missing',
    () => readPage(page),
    (read) => read.noAudio === true,
    WARNING_MS,
  );
  console.log(
    `  page ${((Date.now() - startedAt) / 1000).toFixed(1)} s after the start: ${JSON.stringify(warned)}`,
  );
  if (warned.noAudio !== true) problems.push('the snapshot does not say the audio is missing');
  const stored = await storedRecording(page, id);
  console.log(`  stored meanwhile: ${stored?.chunkCount ?? 0} chunks, ${stored?.byteSize ?? 0} B`);
  const lines = await linesMatching(page, since, LINE);
  for (const line of lines) console.log(`  diagnostics: ${line}`);
  if (lines.length !== 1) problems.push(`${lines.length} Diagnostics lines say it, not 1`);
  await checkWarned(page, problems);
  await page.evaluate(() => window.__e2eReleaseAudio?.());
  await checkCleared(page, since, problems);
  const after = await linesMatching(page, since, LINE);
  if (after.length !== 1) problems.push(`${after.length} lines say it by the end, not 1`);
  return id;
}

export async function scenarioNoAudioTold({ browser, target }: ScenarioContext): Promise<void> {
  console.log(
    `▶ ${target.id} scenario 104: a recording with video whose audio has not started → Diagnostics, the card, the popup and the badge say so until it starts`,
  );
  const since = Date.now();
  const page = await openMeeting(browser, meetingUrl(target));
  const problems: string[] = [];
  try {
    const result = videoModeSchema.safeParse(await probe(page, 'settings:video-on'));
    if (!result.success || result.data.videoMode !== 'tiles') {
      throw new Error('could not switch video on through the debug probe');
    }
    await holdAudio(page);
    await watchToasts(page);
    const before = new Set(await listWebm());
    await page.click('#start');
    const id = await recordWithoutAudio(page, since, problems);
    await waitForEveryTrack(page, id);
    await sleep(1_000);
    await pressCardButton(page, 'Stop');
    const file = await waitForNewRecording(before);
    const info = await inspectWebm(file);
    console.log(`  ${path.basename(file)} → ${describeWebm(info)}`);
    if (info.tracks !== 2 || info.video === null) {
      problems.push(`the file holds ${describeWebm(info)}, not video and audio`);
    }
  } finally {
    await page.close();
  }
  if (problems.length > 0) throw new Error(problems.join('; '));
}

export const registration = {
  name: '104',
  // Next to scenario 103, whose first part holds the audio back the same way for a whole recording.
  after: '103',
  scenario: scenarioNoAudioTold,
} satisfies ScenarioRegistration;
