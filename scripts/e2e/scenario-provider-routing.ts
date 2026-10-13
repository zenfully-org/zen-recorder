/**
 * E2e scenario routing, the first of the run, against every provider's fixture page: the page's own
 * provider records it, and the page has one status card (one bridge per page).
 */
import { expectEqual, openMeeting, probe } from './harness';
import type { ScenarioContext, ScenarioRegistration } from './order-scenarios';
import { meetingUrl } from './targets';

/** The right provider must own the page: the snapshot says which one is recording it. */
export async function scenarioProviderRouting({ browser, target }: ScenarioContext): Promise<void> {
  console.log(`▶ ${target.id}: the ${target.label} provider owns the fixture page`);
  const page = await openMeeting(browser, meetingUrl(target));
  const provider = await page.evaluate(() => window.__zenRecorderPage?.snapshot().provider);
  expectEqual(provider, target.id, 'provider recording this page');
  const overlays = await page.evaluate(
    () => document.querySelectorAll('zen-recorder-overlay').length,
  );
  expectEqual(overlays, 1, 'overlays mounted (one bridge per page)');
  console.log(`  opfs probe: ${JSON.stringify(await probe(page, 'opfs'))}`);
  await page.close();
}

export const registration = {
  name: 'routing',
  after: 'start',
  scenario: scenarioProviderRouting,
} satisfies ScenarioRegistration;
