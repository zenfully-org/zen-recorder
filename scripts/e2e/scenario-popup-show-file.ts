/**
 * E2e scenario 45, run against every provider's fixture page like the ones in `scenarios.ts`: a
 * saved recording's row in the popup offers Show file and Remove, and no button the browser does
 * not let the extension carry out. When the browser no longer lists the recording's download (the
 * person cleared the download list), Show file opens the download folder and says why, with the
 * path the file was saved under, instead of doing nothing. A test build notes what Show file
 * revealed instead of opening a file manager (the `downloads:revealed` probe).
 *
 * The test browser may not open the extension's pages, so the background opens the popup's page in
 * a tab, clicks the button and reads the row (the `popup:show-file` probe of test builds).
 */
import { z } from 'zod';
import {
  currentRecordingId,
  listWebm,
  openMeeting,
  probe,
  sleep,
  waitFor,
  waitForNewRecording,
} from './harness';
import type { ScenarioContext } from './scenarios';
import { meetingUrl } from './targets';

const recordingsSchema = z.object({
  recordings: z.array(z.object({ id: z.string(), status: z.string() })),
});
const erasedSchema = z.object({ erased: z.number(), filename: z.string() });
const rowSchema = z.object({ buttons: z.array(z.string()), failure: z.string() });
const revealedSchema = z.object({ revealed: z.array(z.string()) });

/** What the row says when the browser no longer lists the file, up to the file's path. */
export const NOT_LISTED =
  'Could not show the file: Firefox no longer lists it among its downloads (it forgets them when ' +
  'it restarts or when the list is cleared), so the download folder opened instead. It was saved as ';

export async function scenarioPopupShowFile({ browser, target }: ScenarioContext): Promise<void> {
  console.log(
    `▶ ${target.id} scenario 45: a saved recording's row in the popup → Show file and Remove only, and Show file says why it failed when the download list lost the file`,
  );
  const before = new Set(await listWebm());
  const page = await openMeeting(browser, meetingUrl(target));
  await page.click('#start');
  const id = await waitFor('recording', () => currentRecordingId(page), 20_000);
  await sleep(3_000);
  await page.evaluate(() => window.__fixture.clickOverlay('Stop'));
  await waitForNewRecording(before);
  await waitFor(
    'the recording saved',
    async () => {
      const { recordings } = recordingsSchema.parse(await probe(page, 'background:state'));
      return recordings.find((recording) => recording.id === id)?.status === 'saved';
    },
    20_000,
  );

  const { erased, filename } = erasedSchema.parse(await probe(page, 'downloads:forget-newest'));
  console.log(
    `  ${erased} download(s) of ${filename} taken out of the browser's list, the file kept`,
  );
  const answer = await probe(page, 'popup:show-file');
  const row = rowSchema.safeParse(answer);
  if (!row.success) throw new Error(`popup:show-file probe: ${JSON.stringify(answer)}`);
  const buttons = row.data.buttons.join(', ');
  const failure = row.data.failure;
  console.log(`  the row's buttons: ${buttons}`);
  console.log(`  after Show file: ${failure === '' ? '(nothing shown)' : failure}`);
  const { revealed } = revealedSchema.parse(await probe(page, 'downloads:revealed'));
  console.log(`  Show file revealed: ${revealed.join(', ') || 'nothing'}`);

  const problems = [
    ...(buttons === 'Show file, Remove'
      ? []
      : [`the row offers ${buttons}, expected Show file, Remove`]),
    ...(failure === `${NOT_LISTED}${filename}`
      ? []
      : [`Show file did not say why it could not show the file (${failure || 'nothing shown'})`]),
    ...(revealed.join() === '(the download folder)'
      ? []
      : [`Show file revealed ${revealed.join(', ') || 'nothing'}, expected the download folder`]),
  ];
  if (problems.length > 0) throw new Error(problems.join('; '));
  await page.close();
}
