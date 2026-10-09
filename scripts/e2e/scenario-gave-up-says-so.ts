/**
 * E2e scenario 81, run against every provider's fixture page like the ones in `scenarios.ts`: the
 * audio encoder fails four times in a row, so the recorder stops restarting it → the tab's status
 * card says "Not recording" and "Recording failed", that Record tries again, beside one toast, and
 * the popup's card for the meeting says the same. Record then records again, and the words go.
 *
 * The test browser may not open the extension's pages, so the background opens the popup's page in
 * a tab and reads its cards (`popup:cards`). Every check is made and reported before the scenario
 * fails, so one run of an older build shows each thing it gets wrong.
 */
import type { Page } from 'puppeteer';
import { z } from 'zod';
import {
  currentRecordingId,
  failLastMediaRecorder,
  openMeeting,
  probe,
  sleep,
  toastsOf,
  trackMediaRecorders,
  waitFor,
  watchToasts,
} from './harness';
import type { ScenarioContext } from './scenarios';
import { meetingUrl } from './targets';

/** The recorder restarts a failed encoder three times in a row, then gives up. */
const FAILURES = 4;
const RECORD_AGAIN = 'Press Record to try again';
/** The popup shows the snapshot the background got last, which can be seconds behind the page's. */
const POPUP_WAIT_MS = 20_000;

const videoModeSchema = z.object({ videoMode: z.string() });
const cardsSchema = z.object({ cards: z.array(z.string()) });
const pageSchema = z.object({
  state: z.string(),
  // Absent from builds that do not report it, and while the recorder still restarts.
  encoderGaveUp: z.boolean().optional(),
});
const cardSchema = z.object({ status: z.string(), alert: z.string(), notice: z.string() });

const readPage = async (page: Page) =>
  pageSchema.parse(await page.evaluate(() => window.__zenRecorderPage?.snapshot()));

/**
 * The status card's status, the few words beside it and the sentence in its details. No function
 * is declared inside `evaluate`: the e2e run's compiler names functions with a helper the page lacks.
 */
const readCard = async (page: Page) =>
  cardSchema.parse(
    await page.evaluate(() => {
      const root = window.__fixture.cardRoot();
      return {
        status: root?.querySelector('.zr-status')?.textContent ?? '',
        alert: root?.querySelector('.zr-alert')?.textContent ?? '',
        notice: root?.querySelector('.zr-notice')?.textContent ?? '',
      };
    }),
  );

/** Opens the popup again until a card satisfies `wanted`, for a while; returns the last read. */
async function readPopupUntil(page: Page, wanted: (card: string) => boolean): Promise<string[]> {
  let cards: string[] = [];
  await waitFor(
    'the popup',
    async () => {
      cards = cardsSchema.parse(await probe(page, 'popup:cards')).cards;
      return cards.some(wanted) ? true : null;
    },
    POPUP_WAIT_MS,
  ).catch(() => undefined);
  return cards;
}

/** Fails the running recording's encoder `count` times, each time once its restart records. */
async function failInARow(page: Page, count: number): Promise<void> {
  for (let failure = 1; failure <= count; failure++) {
    const failing = await waitFor('a recording', () => currentRecordingId(page), 20_000);
    await sleep(1_500);
    await failLastMediaRecorder(page, 'injected by the e2e run');
    if (failure === count) return;
    await waitFor(
      `the restart after failure ${failure}`,
      async () => {
        const id = await currentRecordingId(page);
        return id !== null && id !== failing ? id : null;
      },
      20_000,
    );
  }
}

export async function scenarioGaveUpSaysSo({ browser, target }: ScenarioContext): Promise<void> {
  console.log(
    `▶ ${target.id} scenario 81: the encoder fails ${FAILURES} times in a row → the card and the popup say the recording failed and that Record tries again`,
  );
  const page = await openMeeting(browser, meetingUrl(target));
  const problems: string[] = [];
  try {
    const off = videoModeSchema.parse(await probe(page, 'settings:video-off'));
    if (off.videoMode !== 'off') throw new Error('could not switch video off');
    await watchToasts(page);
    await trackMediaRecorders(page);
    await page.click('#start');
    await failInARow(page, FAILURES);
    const gaveUp = await waitFor(
      'the recorder to give up',
      async () => {
        const snapshot = await readPage(page);
        return snapshot.state === 'waiting' && (await currentRecordingId(page)) === null
          ? snapshot
          : null;
      },
      20_000,
    );
    console.log(`  page: ${JSON.stringify(gaveUp)}`);
    await sleep(1_500);
    const card = await readCard(page);
    console.log(`  status card: "${card.status}" "${card.alert}": ${card.notice}`);
    if (card.status !== 'Not recording' || card.alert !== 'Recording failed') {
      problems.push(`the status card says "${card.status}" "${card.alert}"`);
    }
    if (!card.notice.includes(RECORD_AGAIN))
      problems.push('its details do not say to press Record');
    const toasts = (await toastsOf(page)).filter((toast) => toast.text.includes(RECORD_AGAIN));
    for (const toast of await toastsOf(page)) console.log(`  toast (${toast.kind}): ${toast.text}`);
    if (toasts.length !== 1) problems.push(`${toasts.length} toasts say to press Record, not 1`);
    const saysIt = (text: string) =>
      text.includes('Recording failed.') && text.includes(RECORD_AGAIN);
    const popup = await readPopupUntil(page, saysIt);
    for (const text of popup) console.log(`  popup card: ${text}`);
    if (!popup.some(saysIt)) problems.push('no popup card says the recording failed');

    await page.evaluate(() => window.__fixture.clickOverlay('Record'));
    await waitFor('recording again', () => currentRecordingId(page), 20_000);
    const after = await readCard(page);
    console.log(`  after Record: "${after.status}" "${after.alert}"`);
    if (after.alert !== '') problems.push(`after Record the card still says "${after.alert}"`);
    await page.evaluate(() => window.__fixture.clickOverlay('Stop'));
    await sleep(2_000);
  } finally {
    await probe(page, 'settings:video-on');
    await page.close();
  }
  if (problems.length > 0) throw new Error(problems.join('; '));
}
