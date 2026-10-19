/**
 * E2e scenario 97, run against every provider's fixture page: the toolbar badge says when a meeting
 * tab cannot record as it should because the page holds as much as it may of what could not be
 * saved yet, and stops saying it once that is over.
 *   - With video: the record dot on red while it records, II while it is paused. Then the store
 *     refuses every chunk, as on a full disk, until the page holds its limit: the rest of the
 *     meeting records audio only. The badge turns to ! on amber, its title saying the video
 *     stopped, and back to the dot once storing works again and the page has handed the video
 *     over.
 *   - Then audio alone under a small limit: the page stops recording and waits until the extension
 *     has taken what it holds. The tab is stopping, which by its state alone left the badge blank:
 *     ! on amber, its title saying nothing records, until the store works again and the next
 *     recording starts by itself.
 * The background reads its own badge (`badge`). It follows the snapshot the background got last,
 * a moment behind the page's, so each check reads it again for a while. Each check also reads the
 * badge the browser window draws: Firefox cuts a text wider than the badge, without an ellipsis
 * ("REC" showed as "RE" and part of a C), so every text the badge shows must fit it. Every check
 * is made and reported before the scenario fails, so one run of an older build shows each thing
 * it gets wrong.
 * Every recording is saved.
 */
import type { Page } from 'puppeteer';
import { z } from 'zod';
import { describeBadgeCut } from './describe-badge-cut';
import {
  currentRecordingId,
  openMeeting,
  overlayState,
  pressCardButton,
  pressCardButtonWhenShown,
  probe,
  readBadge,
  storedRecording,
  type ToolbarBadge,
  waitFor,
} from './harness';
import type { ScenarioContext, ScenarioRegistration } from './order-scenarios';
import { meetingUrl } from './targets';
import { waitForEveryTrack } from './wait-for-every-track';
import { waitForFirstChunk } from './wait-for-first-chunk';

/** The page's limit while it records video: filled within half a minute of the fixture's video. */
const VIDEO_LIMIT_BYTES = 2 ** 20;
/** The page's limit for audio alone: about 8 s of audio. */
const AUDIO_LIMIT_BYTES = 64 * 2 ** 10;
/** The badge follows the snapshot the background got last, which can be seconds behind the page's. */
const BADGE_WAIT_MS = 20_000;
/** The page fills its limit, or hands over what it holds, within this once the store changes. */
const PAGE_WAIT_MS = 120_000;

const pageSchema = z.object({
  // Absent while the page holds less than its limit.
  backlogFull: z.string().optional(),
});
const armedSchema = z.object({ armed: z.literal(true) });

/** What the badge must show at a step: its text, the start of its title and, for a fault, amber. */
interface Wanted {
  text: string;
  title: string;
  amber: boolean;
}

const RECORDING: Wanted = { text: '●', title: 'Zen Recorder: recording', amber: false };
const PAUSED: Wanted = { text: 'II', title: 'Zen Recorder: paused', amber: false };
const AUDIO_ONLY: Wanted = { text: '!', title: 'Zen Recorder: audio only.', amber: true };
const WAITING: Wanted = { text: '!', title: 'Zen Recorder: waiting for space.', amber: true };
/** The status card's amber, as Firefox gives the badge's colour back. */
const AMBER = '254,154,0,255';

const shows = (badge: ToolbarBadge, wanted: Wanted): boolean =>
  badge.text === wanted.text &&
  badge.drawn.text === wanted.text &&
  badge.title.startsWith(wanted.title) &&
  (badge.color.join(',') === AMBER) === wanted.amber;

const describeBadge = (badge: ToolbarBadge): string =>
  `"${badge.text}" on rgba(${badge.color.join(', ')}) in rgba(${badge.textColor.join(', ')}), title "${badge.title}", drawn "${badge.drawn.text}" ${badge.drawn.scrollWidth} px in ${badge.drawn.clientWidth} px`;

/**
 * Reads the badge until it shows `wanted`, for a while; logs it, and notes it when it does not, or
 * when Firefox cuts its text.
 */
async function checkBadge(
  page: Page,
  wanted: Wanted,
  when: string,
  problems: string[],
): Promise<void> {
  const start = Date.now();
  const seen = await waitFor(
    `the badge ${when}`,
    async () => {
      const badge = await readBadge(page);
      return shows(badge, wanted) ? badge : null;
    },
    BADGE_WAIT_MS,
  ).catch(() => null);
  const badge = seen ?? (await readBadge(page));
  const after = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`  badge ${when} (${after} s): ${describeBadge(badge)}`);
  if (seen === null) {
    problems.push(
      `the badge ${when} is ${describeBadge(badge)}, not "${wanted.text}"${wanted.amber ? ' on amber' : ''} with a title starting "${wanted.title}"`,
    );
  }
  const cut = describeBadgeCut(badge.drawn);
  if (cut !== null) problems.push(`${cut} ${when}`);
}

const backlogFull = async (page: Page): Promise<string | undefined> =>
  pageSchema.parse(await page.evaluate(() => window.__zenRecorderPage?.snapshot() ?? {}))
    .backlogFull;

/** Waits until the page's snapshot says `wanted` (undefined: it holds less than its limit). */
const pageSays = (page: Page, wanted: string | undefined, what: string) =>
  waitFor(what, async () => ((await backlogFull(page)) === wanted ? true : null), PAGE_WAIT_MS);

/** Waits for the page to record something other than `other`; returns it once a chunk is stored. */
async function nextRecording(page: Page, other: string | null, what: string): Promise<string> {
  const id = await waitFor(
    what,
    async () => {
      const current = await currentRecordingId(page);
      return current !== null && current !== other ? current : null;
    },
    PAGE_WAIT_MS,
  );
  await waitForFirstChunk(page, id, PAGE_WAIT_MS);
  return id;
}

async function setLimit(page: Page, bytes: number): Promise<void> {
  const limit = await page.evaluate(
    (value) => window.__zenRecorderPage?.setBacklogLimit?.(value) ?? null,
    bytes,
  );
  if (limit?.backlogLimitBytes !== bytes) {
    throw new Error("this build cannot lower the page's backlog limit");
  }
}

/**
 * The store refuses every chunk until the page says `full`, `during` runs, then the store works
 * again until the page has handed over what it held. Returns what `during` returned.
 */
async function outage<T>(page: Page, full: string, during: () => Promise<T>): Promise<T> {
  armedSchema.parse(await probe(page, 'store:fail-chunks'));
  let result: T;
  try {
    await pageSays(page, full, `the page to say ${full}`);
    result = await during();
  } finally {
    await probe(page, 'store:restore-chunks');
  }
  await pageSays(page, undefined, 'the page to hand over what it held');
  return result;
}

/** With video: the page fills its limit and records audio only. Returns the recordings. */
async function videoStops(page: Page, problems: string[]): Promise<string[]> {
  await setLimit(page, VIDEO_LIMIT_BYTES);
  await page.click('#start');
  const first = await nextRecording(page, null, 'the recording with video');
  await checkBadge(page, RECORDING, 'while it records', problems);
  await pressCardButtonWhenShown(page, 'Pause');
  await checkBadge(page, PAUSED, 'while it is paused', problems);
  await pressCardButtonWhenShown(page, 'Resume');
  const audioOnly = await outage(page, 'audio-only', async () => {
    const id = await currentRecordingId(page);
    await checkBadge(page, AUDIO_ONLY, 'while the video stopped', problems);
    return id;
  });
  const back = await nextRecording(page, audioOnly ?? first, 'the recording with the video back');
  await checkBadge(page, RECORDING, 'once the video is handed over', problems);
  return [first, ...(audioOnly === null ? [] : [audioOnly]), back];
}

/** Audio alone under a small limit: the page stops recording until it is taken what it holds. */
async function audioWaits(page: Page, running: string, problems: string[]): Promise<string[]> {
  // A Stop before the first sample of the recording with the video back would save nothing of it.
  await waitForEveryTrack(page, running);
  await probe(page, 'settings:video-off');
  await setLimit(page, AUDIO_LIMIT_BYTES);
  await pressCardButton(page, 'Stop');
  // Record pressed while the stop is still under way would be ignored.
  await waitFor(
    'the stop',
    async () => ['waiting', 'idle'].includes((await overlayState(page)) ?? ''),
    20_000,
  );
  await pressCardButton(page, 'Record');
  const filling = await nextRecording(page, running, 'the audio-only recording');
  await outage(page, 'waiting', () => checkBadge(page, WAITING, 'while nothing records', problems));
  const next = await nextRecording(page, filling, 'the next recording');
  await checkBadge(page, RECORDING, 'once the page is taken what it held', problems);
  // The Stop follows: its file needs a sample too.
  await waitForEveryTrack(page, next);
  return [filling, next];
}

/** Stops the recording and waits until every recording the scenario saw is saved. */
async function allSaved(page: Page, ids: readonly string[], problems: string[]): Promise<void> {
  await pressCardButton(page, 'Stop');
  for (const id of ids) {
    const saved = await waitFor(
      `${id} saved`,
      async () => ((await storedRecording(page, id))?.status === 'saved' ? true : null),
      90_000,
    ).catch(() => false);
    if (!saved) problems.push(`${id} was not saved: ${(await storedRecording(page, id))?.status}`);
  }
}

export async function scenarioBadgeSaysFault({ browser, target }: ScenarioContext): Promise<void> {
  console.log(
    `▶ ${target.id} scenario 97: the page holds its limit → the toolbar badge says the video stopped, then that nothing records, until it is over`,
  );
  const page = await openMeeting(browser, meetingUrl(target));
  const problems: string[] = [];
  try {
    const withVideo = await videoStops(page, problems);
    const audio = await audioWaits(page, withVideo.at(-1) ?? '', problems);
    await allSaved(page, [...withVideo, ...audio], problems);
  } finally {
    await probe(page, 'settings:video-on');
    await page.close();
  }
  if (problems.length > 0) throw new Error(problems.join('; '));
}

export const registration = {
  name: '97',
  after: '75',
  scenario: scenarioBadgeSaysFault,
} satisfies ScenarioRegistration;
