/**
 * E2e scenario 17, run against every provider's fixture page with a host side (Zoom, whose counter
 * counts the waiting room): the host alone in the meeting, a guest knocks → nothing records until
 * the guest is let in.
 */
import path from 'node:path';
import {
  describeWebm,
  expectEqual,
  inspectWebm,
  listWebm,
  openMeeting,
  overlayState,
  pressCardButton,
  recordingStarted,
  sleep,
  waitFor,
  waitForNewRecording,
} from './harness';
import type { ScenarioContext, ScenarioRegistration } from './order-scenarios';
import { meetingUrl } from './targets';

declare module './harness' {
  interface FixtureApi {
    /**
     * The host's side only (`FixtureTarget.hostMeetingPath`): a guest enters the waiting room, and
     * the host lets them in. Fake pages without a host side leave both out.
     */
    knock?(): void;
    letIn?(): void;
  }
}

/** How long the guest waits to be let in: several of the session's once-a-second page reads. */
const KNOCK_MS = 8_000;

export async function scenarioGuestKnocks({ browser, target }: ScenarioContext): Promise<void> {
  const { hostMeetingPath } = target;
  if (!hostMeetingPath) {
    console.log(`▶ ${target.id} scenario 17: skipped (the fake page has no host side)`);
    return;
  }
  console.log(
    `▶ ${target.id} scenario 17: the host alone, a guest knocks → nothing records until the guest is let in`,
  );
  const before = new Set(await listWebm());
  const page = await openMeeting(browser, meetingUrl(target, hostMeetingPath));
  await page.click('#start');
  const overlay = () => page.evaluate(() => window.__fixture.overlayState());
  let last: Awaited<ReturnType<typeof overlay>> = null;
  await waitFor(
    'the host alone in the meeting',
    async () => {
      last = await overlay();
      const inCall = (await page.evaluate(() => window.__fixture.tileCount())) === 1;
      return inCall && last?.state === 'waiting' && !last.text?.includes('to be admitted');
    },
    20_000,
  ).catch((error: unknown) => {
    throw new Error(`${String(error)}; the overlay last showed ${JSON.stringify(last)}`);
  });
  await sleep(2_000);
  expectEqual(await overlayState(page), 'waiting', 'state while alone');
  const knockedAt = await page.evaluate(() => {
    window.__fixture.knock?.();
    return Date.now();
  });
  const seen = new Set<string>();
  let startedWhileWaiting: number | null = null;
  while (Date.now() - knockedAt < KNOCK_MS) {
    const state = await overlayState(page);
    const counter = await page.evaluate(
      () => document.querySelector('#participant .footer-button__number-counter')?.textContent,
    );
    seen.add(`${state} (participant counter ${counter})`);
    if (startedWhileWaiting === null && (await recordingStarted(page))) {
      startedWhileWaiting = Date.now() - knockedAt;
    }
    await sleep(250);
  }
  console.log(`  while the guest waits: ${JSON.stringify([...seen])}`);
  if (startedWhileWaiting !== null) {
    await pressCardButton(page, 'Stop');
    const early = await waitForNewRecording(before);
    console.log(`  saved: ${path.basename(early)} → ${describeWebm(await inspectWebm(early))}`);
    await page.close();
    throw new Error(
      `a recording started ${startedWhileWaiting} ms after the guest knocked, before anyone was let in`,
    );
  }
  const letInAt = await page.evaluate(() => {
    window.__fixture.letIn?.();
    return Date.now();
  });
  const startedAt = await waitFor(
    'recording once the guest is in',
    () => page.evaluate(() => window.__zenRecorderPage?.snapshot().recordingStartedAt),
    10_000,
  );
  console.log(`  recording started ${startedAt - letInAt} ms after the guest was let in`);
  await sleep(3_000);
  await pressCardButton(page, 'Stop');
  const file = await waitForNewRecording(before);
  console.log(`  saved: ${path.basename(file)} → ${describeWebm(await inspectWebm(file))}`);
  await page.close();
}

export const registration = {
  name: '17',
  after: '72',
  scenario: scenarioGuestKnocks,
} satisfies ScenarioRegistration;
