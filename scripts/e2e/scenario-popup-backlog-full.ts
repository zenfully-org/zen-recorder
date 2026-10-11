/**
 * E2e scenario 75, run against every provider's fixture page like the ones in `scenarios.ts`: the
 * store refuses every chunk, as on a full disk, until the meeting page holds its limit and the
 * video stops → the popup's card for that meeting says "Audio only" and why, as the tab's status
 * card does, and says nothing of it once storing works again and the page has handed the video
 * over. Someone who turned the status card off sees it there.
 *
 * The test browser may not open the extension's pages, so the background opens the popup's page in
 * a tab and reads its cards (`popup:cards`). Every check is made and reported before the scenario
 * fails, so one run of an older build shows each thing it gets wrong.
 */
import type { Page } from 'puppeteer';
import { z } from 'zod';
import { currentRecordingId, openMeeting, pressCardButton, probe, waitFor } from './harness';
import type { ScenarioContext } from './scenarios';
import { meetingUrl } from './targets';

/** The page's limit while it records video: filled within half a minute of the fixture's video. */
const LIMIT_BYTES = 2 ** 20;
/** The words of the popup's card while the video stopped. */
const AUDIO_ONLY = 'Audio only.';
const VIDEO_STOPPED = 'The video stopped';
/** The popup shows the snapshot the background got last, which can be seconds behind the page's. */
const POPUP_WAIT_MS = 20_000;

const cardsSchema = z.object({ cards: z.array(z.string()) });
const recordingsSchema = z.object({
  recordings: z.array(z.object({ id: z.string(), status: z.string(), chunkCount: z.number() })),
});
const armedSchema = z.object({ armed: z.literal(true) });
const backlogSchema = z.object({
  // Absent from builds that do not report it, and while the page holds less than its limit.
  backlogFull: z.string().optional(),
});

const popupCards = async (page: Page): Promise<string[]> =>
  cardsSchema.parse(await probe(page, 'popup:cards')).cards;

const saysAudioOnly = (card: string): boolean =>
  card.includes(AUDIO_ONLY) && card.includes(VIDEO_STOPPED);

/** Opens the popup again until its cards satisfy `done`, for a while; logs and returns the last. */
async function readPopupUntil(
  page: Page,
  when: string,
  done: (cards: string[]) => boolean,
): Promise<string[]> {
  const start = Date.now();
  let cards: string[] = [];
  await waitFor(
    `the popup ${when}`,
    async () => {
      cards = await popupCards(page);
      return done(cards) ? true : null;
    },
    POPUP_WAIT_MS,
  ).catch(() => undefined);
  const after = ((Date.now() - start) / 1000).toFixed(1);
  for (const card of cards) console.log(`  popup card ${when} (${after} s): ${card}`);
  return cards;
}

const backlogFull = async (page: Page): Promise<string | undefined> =>
  backlogSchema.parse(await page.evaluate(() => window.__zenRecorderPage?.snapshot() ?? {}))
    .backlogFull;

const recording = async (page: Page, id: string) =>
  recordingsSchema
    .parse(await probe(page, 'background:state'))
    .recordings.find((candidate) => candidate.id === id);

/** Waits until the page's snapshot says `wanted` (undefined: nothing is full). */
const waitForBacklog = (page: Page, wanted: string | undefined, what: string) =>
  waitFor(what, async () => ((await backlogFull(page)) === wanted ? true : null), 60_000);

export async function scenarioPopupBacklogFull({
  browser,
  target,
}: ScenarioContext): Promise<void> {
  console.log(
    `▶ ${target.id} scenario 75: the page holds its limit and the video stops → the popup says "Audio only" and why, until it is over`,
  );
  const page = await openMeeting(browser, meetingUrl(target));
  const limit = await page.evaluate(
    (bytes) => window.__zenRecorderPage?.setBacklogLimit?.(bytes) ?? null,
    LIMIT_BYTES,
  );
  if (limit?.backlogLimitBytes !== LIMIT_BYTES) {
    throw new Error("this build cannot lower the page's backlog limit");
  }
  await page.click('#start');
  const first = await waitFor('recording', () => currentRecordingId(page), 20_000);
  await waitFor(
    'the first chunk stored',
    async () => (await recording(page, first))?.chunkCount,
    15_000,
  );

  armedSchema.parse(await probe(page, 'store:fail-chunks'));
  const problems: string[] = [];
  try {
    await waitForBacklog(page, 'audio-only', 'the video to stop');
    const during = await readPopupUntil(page, 'while the video stopped', (cards) =>
      cards.some(saysAudioOnly),
    );
    if (!during.some(saysAudioOnly)) {
      problems.push(`no popup card says "${AUDIO_ONLY}" and why while the video stopped`);
    }
  } finally {
    await probe(page, 'store:restore-chunks');
  }

  await waitForBacklog(page, undefined, 'the page to hand the video over');
  const over = (cards: string[]) => !cards.some((card) => card.includes(AUDIO_ONLY));
  if (!over(await readPopupUntil(page, 'once it is over', over))) {
    problems.push(`a popup card still says "${AUDIO_ONLY}" once it is over`);
  }

  const last = await currentRecordingId(page);
  await pressCardButton(page, 'Stop');
  for (const id of new Set([first, last].filter((value) => value !== null))) {
    const saved = await waitFor(
      `${id} saved`,
      async () => ((await recording(page, id))?.status === 'saved' ? true : null),
      90_000,
    ).catch(() => false);
    if (!saved) problems.push(`${id} was not saved: ${(await recording(page, id))?.status}`);
  }
  await page.close();
  if (problems.length > 0) throw new Error(problems.join('; '));
}
