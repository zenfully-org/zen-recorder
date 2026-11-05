/**
 * E2e scenario 102, run against every provider's fixture page: on a page of the service that shows
 * no meeting (`FixtureTarget.noMeetingPath`: Meet's landing page, Zoom's web client home, Teams'
 * app), nothing offers Record and nothing records.
 *
 * Such a page has nothing to record: a recording started there stopped at the page's next reading
 * of it, a second later, before its first sample, and was refused without a file. The popup still
 * offered "Record now" for the tab, and the keyboard shortcut started that recording too.
 *
 *   - The popup's card for the tab says "No meeting" and offers no Record now. The status card
 *     stays hidden.
 *   - The keyboard shortcut (the manifest's `toggle-recording`), pressed with the tab in front,
 *     starts nothing: the page records nothing, the background stores no recording, and the page
 *     writes one Diagnostics line that says why.
 *
 * Every check is made and reported before the scenario fails, so one run of an older build shows
 * each thing it gets wrong.
 */
import type { Page } from 'puppeteer';
import { z } from 'zod';
import {
  builtManifest,
  openMeeting,
  pageDiagnostics,
  probe,
  storedRecordings,
  waitFor,
} from './harness';
import type { ScenarioContext, ScenarioRegistration } from './order-scenarios';
import { pressShortcut } from './press-shortcut';
import { meetingUrl } from './targets';

/** The Diagnostics line a refused Record writes. */
const REFUSED = /Record refused: the page names no meeting to record/;
/** A recording started by hand there stopped within a second; this is long enough to see one. */
const NOTHING_RECORDS_MS = 4_000;
/** The popup follows the snapshot the background got last, seconds behind the page. */
const FOLLOW_MS = 20_000;

const pageSchema = z.object({
  state: z.string(),
  meetingCode: z.string().nullable(),
  recordingId: z.string().nullable(),
});
const cardSchema = z.object({ visible: z.string().optional() }).nullable();
const popupSchema = z.object({ cards: z.array(z.string()) });

const readPage = async (page: Page) =>
  pageSchema.parse(await page.evaluate(() => window.__zenRecorderPage?.snapshot()));

const popupCards = async (page: Page): Promise<string[]> =>
  popupSchema.parse(await probe(page, 'popup:cards')).cards;

/** The page's recordings while `forMs` passes, read every 100 ms: one that started and stopped. */
async function recordingsSeen(page: Page, forMs: number): Promise<Set<string>> {
  const seen = new Set<string>();
  for (const end = Date.now() + forMs; Date.now() < end; ) {
    const { recordingId } = await readPage(page);
    if (recordingId !== null) seen.add(recordingId);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return seen;
}

/** What the popup and the status card offer on the page. */
async function checkOffers(page: Page, problems: string[]): Promise<void> {
  const cards = await waitFor(
    'the popup card of the tab',
    async () => {
      const read = await popupCards(page);
      return read.some((text) => text.includes('No meeting')) ? read : null;
    },
    FOLLOW_MS,
  ).catch(() => popupCards(page));
  for (const text of cards) console.log(`  popup card: ${text}`);
  if (!cards.some((text) => text.includes('No meeting')))
    problems.push('no popup card says "No meeting"');
  if (cards.some((text) => text.includes('Record now')))
    problems.push('the popup offers Record now');
  const card = cardSchema.parse(await page.evaluate(() => window.__fixture.overlayState()));
  console.log(`  status card visible: ${card?.visible}`);
  if (card?.visible !== 'false') problems.push(`the status card shows (visible ${card?.visible})`);
}

/** The shortcut with the tab in front: nothing records, and one Diagnostics line says why. */
async function checkShortcut(
  { browser, page, since }: { browser: object; page: Page; since: number },
  problems: string[],
): Promise<void> {
  const shortcut = builtManifest().commands['toggle-recording']?.suggested_key?.default;
  if (!shortcut) throw new Error('the built manifest has no toggle-recording shortcut');
  const stored = new Set((await storedRecordings(page)).map(({ id }) => id));
  await page.bringToFront();
  await pressShortcut(browser, shortcut);
  const seen = await recordingsSeen(page, NOTHING_RECORDS_MS);
  const added = (await storedRecordings(page)).filter(({ id }) => !stored.has(id));
  console.log(
    `  ${shortcut}: the page recorded ${seen.size}, the background stored ${added.length}`,
  );
  for (const { id, status, chunkCount, error } of added)
    console.log(`  stored: ${JSON.stringify({ id, status, chunkCount, error })}`);
  if (seen.size > 0) problems.push(`the shortcut started ${[...seen].join(', ')}`);
  if (added.length > 0) problems.push(`the background stored ${added.length} recording(s)`);
  const lines = await waitFor(
    'the line that says why',
    async () => {
      const read = (await pageDiagnostics(page, since)).filter((line) => REFUSED.test(line));
      return read.length > 0 ? read : null;
    },
    5_000,
  ).catch(async () => (await pageDiagnostics(page, since)).filter((line) => REFUSED.test(line)));
  for (const line of lines) console.log(`  diagnostics: ${line}`);
  if (lines.length !== 1) problems.push(`${lines.length} Diagnostics lines say why, not 1`);
}

export async function scenarioRecordRefusedWithoutMeeting({
  browser,
  target,
}: ScenarioContext): Promise<void> {
  console.log(
    `▶ ${target.id} scenario 102: a page of the service with no meeting (${target.noMeetingPath}) → no Record now in the popup, and the shortcut records nothing`,
  );
  const since = Date.now();
  const page = await openMeeting(browser, meetingUrl(target, target.noMeetingPath));
  const problems: string[] = [];
  try {
    const shown = await readPage(page);
    console.log(`  page: ${JSON.stringify(shown)}`);
    if (shown.meetingCode !== null) problems.push(`the page names meeting ${shown.meetingCode}`);
    await checkOffers(page, problems);
    await checkShortcut({ browser, page, since }, problems);
  } finally {
    await page.close();
  }
  if (problems.length > 0) throw new Error(problems.join('; '));
}

export const registration = {
  name: '102',
  // Next to scenario 101: both open a page that names no meeting the recorder could record.
  after: '101',
  scenario: scenarioRecordRefusedWithoutMeeting,
} satisfies ScenarioRegistration;
