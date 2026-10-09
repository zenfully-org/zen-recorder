/**
 * E2e scenario 64, run against every provider's fixture page like the ones in `scenarios.ts`: alone
 * in a call, the status card and the popup say "Waiting for participants", not that the recording
 * is ready.
 *
 * The recorder waits for someone else before it starts (the start rule), counting the people as
 * the provider does: Zoom and Teams count participants, because Zoom plays everyone's audio through
 * one element and Teams mixes it into one track, both there from the moment the call connects.
 * The status card and the popup counted the remote audio tracks instead, so alone on Zoom and Teams
 * they said "Ready to record" and "Ready". The fixture joins the call as its only participant
 * (Zoom still plays its audio element, Teams its mixed track), and once the call settles both must
 * say the recorder waits for participants. Meet's provider counts no participants (the remote audio
 * tracks decide for the recorder and the words alike), and its fixture skips the scenario.
 */
import { z } from 'zod';
import { openMeeting, probe, sleep, waitFor } from './harness';
import type { ScenarioContext } from './scenarios';
import { meetingUrl } from './targets';

const cardSchema = z.object({ state: z.string().optional(), text: z.string().optional() });
const popupSchema = z.object({ cards: z.array(z.string()) });
const WAITING = 'Waiting for participants';

export async function scenarioAloneSaysWaiting({
  browser,
  target,
}: ScenarioContext): Promise<void> {
  console.log(
    `▶ ${target.id} scenario 64: alone in the call → the status card and the popup say "${WAITING}"`,
  );
  const page = await openMeeting(browser, meetingUrl(target));
  try {
    if (!(await page.evaluate(() => typeof window.__fixture.stayAlone === 'function'))) {
      console.log('  skipped: this provider counts no participants');
      return;
    }
    await page.evaluate(() => window.__fixture.stayAlone?.());
    await page.click('#start');
    const card = async () =>
      cardSchema.nullable().parse(await page.evaluate(() => window.__fixture.overlayState()));
    await waitFor('waiting in the call', async () => (await card())?.state === 'waiting', 20_000);
    // Let the call settle: the remote audio element or mixed track arrives after the connection.
    await sleep(3_000);
    const status = (await card())?.text ?? '';
    const popup = popupSchema.parse(await probe(page, 'popup:cards'));
    // The meeting tab's card: a tab that waits offers Record now (the recordings' cards do not).
    const tab = popup.cards.find((text) => text.includes('Record now'));
    console.log(`  status card: ${status}`);
    console.log(`  popup: ${tab ?? popup.cards.join(' | ')}`);
    const problems = [
      ...(status.includes(WAITING) ? [] : [`the status card says "${status}"`]),
      ...(tab?.includes(WAITING) ? [] : [`the popup says "${tab ?? 'nothing for this tab'}"`]),
    ];
    if (problems.length > 0) {
      throw new Error(`alone in the call, ${problems.join(' and ')}, not "${WAITING}"`);
    }
  } finally {
    await page.close();
  }
}
