/**
 * E2e scenario 22, run against every provider's fixture page: the built manifest's description ends
 * with the independence notice, and the Options page footer shows the version and the full notice.
 */
import { z } from 'zod';
import { getProjectTexts } from '../../src/lib/project/get-project-texts';
import { builtManifest, openMeeting, probe } from './harness';
import type { ScenarioContext, ScenarioRegistration } from './order-scenarios';
import { meetingUrl } from './targets';

/** The short form of the independence notice, which ends the manifest description. */
const SHORT_NOTICE = 'Independent project, not affiliated with Zen Browser.';

const optionsFooterSchema = z.object({ footer: z.array(z.string()).nullable() });

/**
 * Every place that presents the project carries the independence notice: here the two the build
 * makes, the manifest description and the Options page footer, which also names the version.
 */
export async function scenarioProjectNotice({ browser, target }: ScenarioContext): Promise<void> {
  console.log(
    `▶ ${target.id} scenario 22: the manifest description and the Options page footer carry the independence notice`,
  );
  const { version, description } = builtManifest();
  console.log(`  manifest description: ${description}`);
  // The page only relays the probe: the background opens the Options page and reads its footer.
  const page = await openMeeting(browser, meetingUrl(target));
  const answer = await probe(page, 'options:footer');
  await page.close();
  const parsed = optionsFooterSchema.safeParse(answer);
  if (!parsed.success) throw new Error(`options:footer probe: ${JSON.stringify(answer)}`);
  const footer = parsed.data.footer;
  console.log(`  Options page footer: ${footer ? JSON.stringify(footer) : '(none)'}`);
  const problems = [
    ...(description.endsWith(` ${SHORT_NOTICE}`)
      ? []
      : [`the manifest description does not end with "${SHORT_NOTICE}"`]),
    ...(footer?.includes(`Zen Recorder ${version}`)
      ? []
      : [`the Options page footer does not name the version ${version}`]),
    ...(footer?.includes(getProjectTexts().notice)
      ? []
      : ['the Options page footer does not carry the notice']),
  ];
  if (problems.length > 0) throw new Error(problems.join('; '));
}

export const registration = {
  name: '22',
  after: '54',
  scenario: scenarioProjectNotice,
} satisfies ScenarioRegistration;
