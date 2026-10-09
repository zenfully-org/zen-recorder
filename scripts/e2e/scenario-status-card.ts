/**
 * E2e scenario 48, run against every provider's fixture page like the ones in `scenarios.ts`: the
 * status card is used with the real mouse and keyboard, as a person in a call would.
 *
 *   - It starts compact on the middle of the right edge, and a click opens it without taking the
 *     focus from the page.
 *   - Dragged by its Stop button, it moves and stops nothing; dragged again compact, it moves.
 *   - After a reload, and in another meeting of the same service, it is where it was left; on
 *     another service it is at its default place.
 *   - Record, Pause, Resume and Stop clicked on the card drive the recording, and a file is saved.
 *   - From the keyboard, Enter opens it and Escape closes it, and the page hears neither key, not
 *     even with listeners that capture on its window and document.
 */
import path from 'node:path';
import type { Page } from 'puppeteer';
import { z } from 'zod';
import {
  describeWebm,
  expectEqual,
  inspectWebm,
  listWebm,
  openMeeting,
  overlayState,
  recordingStartedAt,
  sleep,
  waitFor,
  waitForNewRecording,
} from './harness';
import type { ScenarioContext } from './scenarios';
import { type FixtureTarget, meetingUrl } from './targets';

const cardSchema = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number(),
  expanded: z.string().nullable(),
  visible: z.string().nullable(),
  viewport: z.object({ width: z.number(), height: z.number() }),
});
type Card = z.infer<typeof cardSchema>;
const pointSchema = z.object({ x: z.number(), y: z.number() }).nullable();

/** Another meeting of the same service: a new meeting id on the target's fixture page. */
function otherMeetingPath(target: FixtureTarget): string {
  switch (target.id) {
    case 'meet':
      return '/klm-nopq-rst';
    case 'zoom':
      return '/zoom/wc/9876543210/join';
    case 'teams': {
      const coords = Buffer.from(
        JSON.stringify({
          conversationId: '19:meeting_T3RoZXJNZWV0aW5n@thread.v2',
          tenantId: '11111111-2222-4333-8444-555555555555',
        }),
      ).toString('base64');
      return `/teams/light-meetings/launch?anon=true&coords=${coords}`;
    }
  }
}

/** A meeting of another service, served by the same fixture server. */
const otherServicePath = (target: FixtureTarget): string =>
  target.id === 'meet' ? '/zoom/wc/1234567890/join' : '/abc-defg-hij';

async function readCard(page: Page): Promise<Card> {
  const card = await page.evaluate(() => {
    const element = window.__fixture.cardRoot()?.querySelector('.zr-card');
    if (!element) return null;
    const { x, y, width, height } = element.getBoundingClientRect();
    return {
      x,
      y,
      width,
      height,
      expanded: element.getAttribute('data-expanded'),
      visible: element.getAttribute('data-visible'),
      // Without the scrollbars, like the area the card is placed in.
      viewport: {
        width: document.documentElement.clientWidth,
        height: document.documentElement.clientHeight,
      },
    };
  });
  return cardSchema.parse(card);
}

/** The centre of a visible element of the card, in the page's coordinates. */
async function centreOf(page: Page, selector: string): Promise<{ x: number; y: number }> {
  const point = pointSchema.parse(
    await page.evaluate((wanted) => {
      const root = window.__fixture.cardRoot();
      const element = root?.querySelector(wanted);
      if (!(element instanceof HTMLElement) || element.hidden) return null;
      const rect = element.getBoundingClientRect();
      return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    }, selector),
  );
  if (!point) throw new Error(`the card shows no ${selector}`);
  return point;
}

/** A real click: the pointer moves there, presses and lets go. */
async function clickCard(page: Page, selector: string): Promise<void> {
  const { x, y } = await centreOf(page, selector);
  await page.mouse.click(x, y);
}

/** A real drag from the centre of `selector` by (dx, dy), in small steps like a hand. */
async function dragCard(page: Page, selector: string, dx: number, dy: number): Promise<void> {
  const { x, y } = await centreOf(page, selector);
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx, y + dy, { steps: 15 });
  await page.mouse.up();
}

const near = (actual: number, expected: number, label: string, slack = 1.5): void => {
  if (Math.abs(actual - expected) > slack)
    throw new Error(`${label}: expected ${expected}, got ${actual}`);
};

function expectSamePlace(actual: Card, expected: Card, where: string): void {
  near(actual.x, expected.x, `${where}: left`);
  near(actual.y, expected.y, `${where}: top`);
  console.log(`  ${where}: the card is at (${Math.round(actual.x)}, ${Math.round(actual.y)})`);
}

function expectDefaultPlace(card: Card, where: string): void {
  near(card.viewport.width - card.x - card.width, 16, `${where}: distance to the right edge`);
  near(card.y + card.height / 2, card.viewport.height / 2, `${where}: vertical centre`, 2);
  console.log(
    `  ${where}: the card is at its default place, (${Math.round(card.x)}, ${Math.round(card.y)})`,
  );
}

async function waitForState(page: Page, state: string): Promise<void> {
  await waitFor(`the ${state} state`, async () => (await overlayState(page)) === state, 20_000);
}

/** Opens a meeting and waits for its card to show. */
async function openCard(context: ScenarioContext, meetingPath: string): Promise<Page> {
  const page = await openMeeting(context.browser, meetingUrl(context.target, meetingPath));
  await waitFor('the card', async () => (await readCard(page)).visible === 'true', 10_000);
  return page;
}

/** Steps 1-2: a click opens the card without the focus, and drags press nothing; returns where it was left. */
async function dragAround(page: Page): Promise<Card> {
  expectDefaultPlace(await readCard(page), 'at first');
  const focused = () => page.evaluate(() => document.activeElement?.outerHTML.slice(0, 60) ?? null);
  const focusedBefore = await focused();
  await clickCard(page, '.zr-toggle');
  expectEqual((await readCard(page)).expanded, 'true', 'the card after a click');
  expectEqual(await focused(), focusedBefore, 'the focused element after the click');
  await sleep(500); // the opening animation is over
  const before = await readCard(page);
  await dragCard(page, '[data-command="stop"]', -(before.viewport.width - 360), 180);
  await sleep(2_000);
  expectEqual(await overlayState(page), 'recording', 'the state after dragging the Stop button');
  const open = await readCard(page);
  expectEqual(open.expanded, 'true', 'the card after a drag');
  near(open.x, Math.max(8, before.x - (before.viewport.width - 360)), 'left after the drag');
  console.log(
    `  dragged open by its Stop button to (${Math.round(open.x)}, ${Math.round(open.y)}), still recording`,
  );
  await clickCard(page, '.zr-toggle');
  expectEqual((await readCard(page)).expanded, 'false', 'the card after a second click');
  await dragCard(page, '.zr-toggle', 60, -40);
  const left = await readCard(page);
  expectEqual(left.expanded, 'false', 'the card after a compact drag');
  expectEqual(await overlayState(page), 'recording', 'the state after the compact drag');
  return left;
}

/** Step 4: Record, Pause, Resume and Stop clicked on the card; returns the files saved. */
async function recordFromCard(page: Page): Promise<string[]> {
  const before = new Set(await listWebm());
  await page.click('#start');
  await waitForState(page, 'recording');
  await clickCard(page, '.zr-toggle');
  await clickCard(page, '[data-command="pause"]');
  await waitForState(page, 'paused');
  await clickCard(page, '[data-command="resume"]');
  await waitForState(page, 'recording');
  await sleep(3_000);
  await clickCard(page, '[data-command="stop"]');
  const first = await waitForNewRecording(before);
  console.log('  Pause, Resume and Stop clicked on the card: saved');
  await waitFor('Record on the card', async () => (await overlayState(page)) === 'waiting', 20_000);
  await clickCard(page, '[data-command="start"]');
  await waitForState(page, 'recording');
  await sleep(3_000);
  await clickCard(page, '[data-command="stop"]');
  const second = await waitForNewRecording(new Set([...before, first]));
  console.log('  Record and Stop clicked on the card: saved');
  await clickCard(page, '.zr-toggle');
  expectEqual((await readCard(page)).expanded, 'false', 'the card after closing it');
  return [first, second];
}

/** Step 5: Enter and Escape on the focused card open and close it, and stop there. */
async function driveWithTheKeyboard(page: Page): Promise<void> {
  await page.evaluate(() => {
    const heard: string[] = [];
    Reflect.set(window, '__heardKeys', heard);
    // As a page's shortcuts listen: on the document, and before that on the window and the
    // document in the capture phase.
    for (const [target, capture] of [
      [window, true],
      [document, true],
      [document, false],
    ] as const) {
      target.addEventListener(
        'keydown',
        (event) => heard.push(event instanceof KeyboardEvent ? event.key : event.type),
        { capture },
      );
    }
    // A keyboard user tabs to the card; the scenario puts the focus there directly.
    const toggle = window.__fixture.cardRoot()?.querySelector('.zr-toggle');
    if (toggle instanceof HTMLElement) toggle.focus();
  });
  await page.keyboard.press('Enter');
  expectEqual((await readCard(page)).expanded, 'true', 'the card after Enter');
  await page.keyboard.press('Escape');
  expectEqual((await readCard(page)).expanded, 'false', 'the card after Escape');
  const heard = await page.evaluate(() => JSON.stringify(Reflect.get(window, '__heardKeys')));
  expectEqual(heard, '[]', 'keys the page heard');
  console.log('  Enter opened the card, Escape closed it, the page heard neither');
}

export async function scenarioStatusCard(context: ScenarioContext): Promise<void> {
  const { target } = context;
  console.log(
    `▶ ${target.id} scenario 48: the status card, clicked, dragged, reloaded and driven with the mouse and the keyboard`,
  );
  const before = new Set(await listWebm());
  const page = await openCard(context, target.meetingPath);
  await page.click('#start');
  await waitForState(page, 'recording');
  const startedAt = await recordingStartedAt(page);
  const left = await dragAround(page);
  await sleep(3_000);
  // The drags stopped nothing: the recording runs on until the call ends, and is saved whole.
  await page.evaluate(() => window.__fixture.hangup());
  const ranS = (Date.now() - startedAt) / 1000;
  const dragged = await inspectWebm(await waitForNewRecording(before));
  console.log(
    `  the recording the drags ran through: ${describeWebm(dragged)} (the call ${ranS.toFixed(1)} s)`,
  );
  if (!(dragged.durationS > ranS - 3))
    throw new Error(`recording cut short: ${dragged.durationS} s`);

  await page.reload({ waitUntil: 'load' });
  await waitFor(
    'the card after the reload',
    async () => (await readCard(page).catch(() => null))?.visible === 'true',
    10_000,
  );
  expectSamePlace(await readCard(page), left, 'after a reload');
  const other = await openCard(context, otherMeetingPath(target));
  expectSamePlace(await readCard(other), left, 'in another meeting of the same service');
  const elsewhere = await openCard(context, otherServicePath(target));
  expectDefaultPlace(await readCard(elsewhere), 'on another service');
  await elsewhere.close();

  await other.bringToFront();
  const files = await recordFromCard(other);
  for (const file of files) {
    const info = await inspectWebm(file);
    console.log(`  file: ${path.basename(file)} → ${describeWebm(info)}`);
    if (!(info.durationS > 2)) throw new Error(`file too short: ${info.durationS} s`);
  }
  await driveWithTheKeyboard(other);
  await other.close();
  await page.close();
}
