/**
 * E2e scenario 101, run against every provider's fixture page that holds a call at an address its
 * provider does not know (`FixtureTarget.unknownAddresses`, Meet's): the recorder says it cannot
 * record there, instead of looking ready.
 *
 * A service that moves its meetings to a new address breaks the recorder silently: the provider
 * reads no meeting there, so nothing records, automatically or on Record. Meet did so once, and
 * calls were lost before anyone noticed.
 *
 *   - The page joins a call with someone else in it, at an address the provider does not know:
 *     nothing records. Diagnostics say so in one line that gives the address's shape (letters as
 *     `a`, digits as `0`) and never the meeting code; the status card shows and says "Not
 *     recording", why and what to do, with no Record button, beside one toast; the popup's card
 *     for the tab says the same, and the toolbar badge shows ! with those words in its title.
 *   - The page moves to another unknown address: a second line gives its shape.
 *   - It moves to the meeting's own address: the words go, and the call records.
 *
 * Every check is made and reported before the scenario fails, so one run of an older build shows
 * each thing it gets wrong. Other providers skip it.
 */
import type { Page } from 'puppeteer';
import { z } from 'zod';
import {
  currentRecordingId,
  listWebm,
  openMeeting,
  pageDiagnostics,
  pressCardButton,
  probe,
  readBadge,
  sleep,
  toastsOf,
  waitFor,
  waitForNewRecording,
  watchToasts,
} from './harness';
import type { ScenarioContext, ScenarioRegistration } from './order-scenarios';
import { meetingUrl } from './targets';
import { waitForEveryTrack } from './wait-for-every-track';

/** The words of the Diagnostics line, the card, the toast, the popup and the badge's title. */
const LINE = /in a call, but the address names no meeting this version knows/;
const LABEL = 'Unknown address';
const WHAT_TO_DO = 'Check for an update';
const BADGE_TITLE = 'Zen Recorder: unknown address.';
/** A call joined at a known address starts recording within a few ticks; here nothing may. */
const NOTHING_RECORDS_MS = 4_000;
/** The popup and the badge follow the snapshot the background got last, seconds behind the page. */
const FOLLOW_MS = 20_000;

const pageSchema = z.object({
  state: z.string(),
  admitted: z.boolean(),
  connected: z.boolean(),
  recordingId: z.string().nullable(),
  // Absent from builds that do not report it.
  unknownAddress: z.boolean().optional(),
});
const cardSchema = z.object({
  visible: z.string(),
  status: z.string(),
  alert: z.string(),
  notice: z.string(),
  buttons: z.array(z.string()),
});
const popupSchema = z.object({ cards: z.array(z.string()) });

const readPage = async (page: Page) =>
  pageSchema.parse(await page.evaluate(() => window.__zenRecorderPage?.snapshot()));

/**
 * Whether the status card shows, its status, the few words beside it, the sentence in its details
 * and the buttons it shows. No function is declared inside `evaluate`: the e2e run's compiler names
 * functions with a helper the page lacks.
 */
const readCard = async (page: Page) =>
  cardSchema.parse(
    await page.evaluate(() => {
      const root = window.__fixture.cardRoot();
      const buttons = [...(root?.querySelectorAll<HTMLElement>('.zr-btn') ?? [])];
      return {
        visible: root?.querySelector<HTMLElement>('.zr-card')?.dataset['visible'] ?? '',
        status: root?.querySelector('.zr-status')?.textContent ?? '',
        alert: root?.querySelector('.zr-alert')?.textContent ?? '',
        notice: root?.querySelector('.zr-notice')?.textContent ?? '',
        buttons: buttons.filter((b) => !b.hidden).map((b) => b.textContent ?? ''),
      };
    }),
  );

/** The page's Diagnostics lines from `since` on that say the address names no meeting. */
const unknownAddressLines = async (page: Page, since: number): Promise<string[]> =>
  (await pageDiagnostics(page, since)).filter((line) => LINE.test(line));

/** Moves the single-page app to `path` the way the service does, without a load. */
const navigate = (page: Page, path: string): Promise<void> =>
  page.evaluate((to) => window.history.pushState(null, '', to), path);

/** Checks one Diagnostics line: it gives the address's shape, and nothing of the address itself. */
function checkLine(
  line: string | undefined,
  { path, shape }: { path: string; shape: string },
  problems: string[],
): void {
  if (line === undefined) return;
  if (!line.includes(` ${shape} `)) problems.push(`the line gives no path shape ${shape}: ${line}`);
  const named = path.split('/').filter((part) => part !== '' && line.includes(`/${part}`));
  if (named.length > 0) problems.push(`the line names ${named.join(', ')}: ${line}`);
}

/** What the card, its toast, the popup and the badge say while the call cannot record. */
async function checkWords(page: Page, problems: string[]): Promise<void> {
  const card = await readCard(page);
  console.log(
    `  status card (visible ${card.visible}): "${card.status}" "${card.alert}": ${card.notice} [${card.buttons.join(', ')}]`,
  );
  if (card.visible !== 'true') problems.push('the status card is hidden');
  if (card.status !== 'Not recording' || card.alert !== LABEL) {
    problems.push(`the status card says "${card.status}" "${card.alert}"`);
  }
  if (!card.notice.includes(WHAT_TO_DO))
    problems.push('its details do not say to check for an update');
  if (card.buttons.includes('Record')) problems.push('the card offers Record, which cannot record');
  const toasts = await toastsOf(page);
  for (const toast of toasts) console.log(`  toast (${toast.kind}): ${toast.text}`);
  if (toasts.filter((toast) => toast.text.includes(WHAT_TO_DO)).length !== 1) {
    problems.push(`${toasts.length} toasts, not one that says to check for an update`);
  }
  const saysIt = (text: string) => text.includes(`${LABEL}.`) && text.includes(WHAT_TO_DO);
  const popup = await waitFor(
    'the popup',
    async () => {
      const { cards } = popupSchema.parse(await probe(page, 'popup:cards'));
      return cards.some(saysIt) ? cards : null;
    },
    FOLLOW_MS,
  ).catch(async () => popupSchema.parse(await probe(page, 'popup:cards')).cards);
  for (const text of popup) console.log(`  popup card: ${text}`);
  if (!popup.some(saysIt)) problems.push('no popup card says the address is unknown');
  if (popup.some((text) => text.includes('Record now')))
    problems.push('the popup offers Record now');
  const badge = await waitFor(
    'the badge',
    async () => {
      const read = await readBadge(page);
      return read.text === '!' && read.title.startsWith(BADGE_TITLE) ? read : null;
    },
    FOLLOW_MS,
  ).catch(() => readBadge(page));
  console.log(`  badge: "${badge.text}", title "${badge.title}"`);
  if (badge.text !== '!' || !badge.title.startsWith(BADGE_TITLE)) {
    problems.push(`the badge shows "${badge.text}", title "${badge.title}"`);
  }
}

/** The page moves to the meeting's own address: the words go and the call records, then stops. */
async function recordsAtKnownAddress(page: Page, path: string, problems: string[]): Promise<void> {
  const before = new Set(await listWebm());
  await navigate(page, path);
  const id = await waitFor(
    'a recording at the known address',
    () => currentRecordingId(page),
    10_000,
  );
  const card = await waitFor(
    'the card to clear its alert',
    async () => {
      const read = await readCard(page);
      return read.alert === '' ? read : null;
    },
    5_000,
  ).catch(() => readCard(page));
  console.log(`  at ${path}: recording ${id}, the card says "${card.status}" "${card.alert}"`);
  if (card.alert !== '') problems.push(`at the known address the card still says "${card.alert}"`);
  await waitForEveryTrack(page, id);
  await sleep(1_000);
  await pressCardButton(page, 'Stop');
  await waitForNewRecording(before);
}

export async function scenarioCallAtUnknownAddress({
  browser,
  target,
}: ScenarioContext): Promise<void> {
  const [first, second] = target.unknownAddresses ?? [];
  if (!first || !second) {
    console.log(`▶ ${target.id} scenario 101: skipped (the service shows no call it cannot name)`);
    return;
  }
  console.log(
    `▶ ${target.id} scenario 101: a call at an address the provider does not know → Diagnostics, the card, the popup and the badge say nothing records`,
  );
  const since = Date.now();
  const page = await openMeeting(browser, meetingUrl(target, first.path));
  const problems: string[] = [];
  try {
    await watchToasts(page);
    await page.click('#start');
    const joined = await waitFor(
      'the page in the call',
      async () => {
        const snapshot = await readPage(page);
        return snapshot.admitted && snapshot.connected ? snapshot : null;
      },
      20_000,
    );
    console.log(`  page: ${JSON.stringify(joined)}`);
    await sleep(NOTHING_RECORDS_MS);
    const stayed = await readPage(page);
    console.log(`  page after ${NOTHING_RECORDS_MS / 1000} s: ${JSON.stringify(stayed)}`);
    if (stayed.recordingId !== null) problems.push(`a recording started: ${stayed.recordingId}`);
    if (stayed.unknownAddress !== true)
      problems.push('the snapshot does not say the address is unknown');
    const lines = await unknownAddressLines(page, since);
    for (const line of lines) console.log(`  diagnostics: ${line}`);
    if (lines.length !== 1) problems.push(`${lines.length} Diagnostics lines say it, not 1`);
    checkLine(lines[0], first, problems);
    await checkWords(page, problems);

    await navigate(page, second.path);
    const both = await waitFor(
      'a line about the second address',
      async () => {
        const read = await unknownAddressLines(page, since);
        return read.length >= 2 ? read : null;
      },
      5_000,
    ).catch(() => unknownAddressLines(page, since));
    console.log(`  after moving to ${second.path}: ${both.length} lines`);
    if (both.length !== 2) problems.push(`${both.length} lines after the second address, not 2`);
    checkLine(both[1], second, problems);

    await recordsAtKnownAddress(page, target.meetingPath, problems);
  } finally {
    await page.close();
  }
  if (problems.length > 0) throw new Error(problems.join('; '));
}

export const registration = {
  name: '101',
  // Next to scenario 100: both open a call at an address other than the one the service used to.
  after: '100',
  scenario: scenarioCallAtUnknownAddress,
} satisfies ScenarioRegistration;
