/**
 * E2e scenario 55, run against every provider's fixture page like the ones in `scenarios.ts`: the
 * popup's meeting controls and its Diagnostics button say why they failed, instead of failing
 * without a word and leaving the rejection to the popup's console.
 *
 * Two meeting tabs are open, and the popup shows a card for each. The scenario stops the popup's
 * refresh (its cards stay as they were), closes one meeting tab and presses that tab's first button
 * (Record now): the background no longer knows the tab, as when a tab closes or reloads between
 * the popup's last refresh and the click. Then it presses Diagnostics. The test browser's click is
 * not the person's input, so Firefox refuses the clipboard write ("lack of user activation"), as it
 * does once a real click's activation has expired.
 *
 * The test browser may not open the extension's pages, so the background opens the popup's page in
 * a tab, clicks and reads it (the `popup:*` probes of test builds).
 */
import { z } from 'zod';
import { openMeeting, probe, waitFor } from './harness';
import type { ScenarioContext } from './scenarios';
import { meetingUrl } from './targets';

const tabsSchema = z.object({ tabs: z.array(z.object({ tabId: z.number() })) });
const openSchema = z.object({ cards: z.number() });
const pressedSchema = z.object({
  button: z.string(),
  failure: z.string(),
  rejections: z.array(z.string()),
});
const diagnosticsSchema = z.object({
  label: z.string(),
  failure: z.string(),
  rejections: z.array(z.string()),
});

/** What the popup says when a meeting tab's card outlived the tab. */
const TAB_GONE =
  'Could not start recording: the meeting tab is no longer connected (it was closed, reloaded or ' +
  'left the meeting)';
/** The start of what the popup says when the Diagnostics could not be copied. */
const NOT_COPIED = 'Could not copy the diagnostics: ';

/** Runs a probe and parses its answer, or says what the probe answered instead. */
async function probed<T>(
  page: Awaited<ReturnType<typeof openMeeting>>,
  name: string,
  schema: z.ZodType<T>,
): Promise<T> {
  const answer = await probe(page, name);
  const parsed = schema.safeParse(answer);
  if (!parsed.success) throw new Error(`${name} probe: ${JSON.stringify(answer)}`);
  return parsed.data;
}

export async function scenarioPopupControlsSayWhy({
  browser,
  target,
}: ScenarioContext): Promise<void> {
  console.log(
    `▶ ${target.id} scenario 55: the popup's meeting controls and Diagnostics fail → the popup says why, nothing left unhandled`,
  );
  const leaving = await openMeeting(browser, meetingUrl(target));
  const staying = await openMeeting(browser, meetingUrl(target));
  await waitFor(
    'both meeting tabs connected',
    async () => tabsSchema.parse(await probe(staying, 'background:state')).tabs.length >= 2,
    15_000,
  );
  const { cards } = await probed(staying, 'popup:open-frozen', openSchema);
  console.log(`  the popup shows ${cards} meeting tab(s), its refresh stopped`);
  const problems: string[] = [];
  try {
    await leaving.close();
    const command = await probed(staying, 'popup:press-lost-tab-command', pressedSchema);
    console.log(
      `  a meeting tab closed; its card's ${command.button}: ${command.failure || '(nothing shown)'}`,
    );
    const diagnostics = await probed(staying, 'popup:press-diagnostics', diagnosticsSchema);
    console.log(
      `  Diagnostics: the button says ${diagnostics.label}; ${diagnostics.failure || '(nothing shown)'}`,
    );
    const rejections = [...new Set([...command.rejections, ...diagnostics.rejections])];
    console.log(`  left unhandled in the popup: ${rejections.join('; ') || 'nothing'}`);
    if (command.failure !== TAB_GONE) {
      problems.push(
        `${command.button} on the closed tab's card said ${command.failure || 'nothing'}, expected ${TAB_GONE}`,
      );
    }
    if (diagnostics.label === 'Copied' || !diagnostics.failure.startsWith(NOT_COPIED)) {
      problems.push(
        `Diagnostics without user activation: the button says ${diagnostics.label} and the popup ${diagnostics.failure || 'nothing'}, expected ${NOT_COPIED}<reason>`,
      );
    }
    if (rejections.length > 0) problems.push(`the popup left unhandled: ${rejections.join('; ')}`);
  } finally {
    await probe(staying, 'popup:close');
    await staying.close();
  }
  if (problems.length > 0) throw new Error(problems.join('; '));
}
