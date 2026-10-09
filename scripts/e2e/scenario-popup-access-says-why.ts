/**
 * E2e scenario 68, run against every provider's fixture page like the ones in `scenarios.ts`: the
 * popup's Grant access says why it failed, instead of failing without a word and leaving the
 * rejection to the popup's console.
 *
 * The scenario takes the meeting services' own sites out of the extension's permissions (the
 * fixture pages run on localhost and never need them), so the popup shows its access banner, and
 * presses Grant access. The test browser's click is not the person's input, so Firefox refuses
 * `permissions.request` ("may only be called from a user input handler"), and the banner must say
 * so. The test browser may not open the extension's pages, so the background opens the popup's page
 * in a tab, clicks and reads it (the `popup:*` probes of test builds).
 */
import { z } from 'zod';
import { openMeeting, probe } from './harness';
import type { ScenarioContext } from './scenarios';
import { meetingUrl } from './targets';

const removedSchema = z.object({ removed: z.boolean() });
const pressedSchema = z.object({ failure: z.string(), rejections: z.array(z.string()) });

/** The start of what the banner says when the browser refuses to ask for access. */
const NOT_ASKED = 'Could not ask for access: ';

export async function scenarioPopupAccessSaysWhy({
  browser,
  target,
}: ScenarioContext): Promise<void> {
  console.log(
    `▶ ${target.id} scenario 68: the popup's Grant access fails → its banner says why, nothing left unhandled`,
  );
  const page = await openMeeting(browser, meetingUrl(target));
  const removedAnswer = await probe(page, 'permissions:remove-providers');
  const removed = removedSchema.safeParse(removedAnswer);
  if (!removed.success) {
    throw new Error(`permissions:remove-providers probe: ${JSON.stringify(removedAnswer)}`);
  }
  console.log(`  the services' own sites taken out of the permissions: ${removed.data.removed}`);
  const answer = await probe(page, 'popup:press-grant-access');
  const pressed = pressedSchema.safeParse(answer);
  if (!pressed.success)
    throw new Error(`popup:press-grant-access probe: ${JSON.stringify(answer)}`);
  const { failure, rejections } = pressed.data;
  console.log(`  Grant access: ${failure || '(nothing shown)'}`);
  console.log(`  left unhandled in the popup: ${rejections.join('; ') || 'nothing'}`);
  const problems = [
    ...(failure.startsWith(NOT_ASKED) && failure.length > NOT_ASKED.length
      ? []
      : [`Grant access said ${failure || 'nothing'}, expected ${NOT_ASKED}<reason>`]),
    ...(rejections.length === 0 ? [] : [`the popup left unhandled: ${rejections.join('; ')}`]),
  ];
  await page.close();
  if (problems.length > 0) throw new Error(problems.join('; '));
}
