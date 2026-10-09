/**
 * E2e scenario 53, run against every provider's fixture page like the ones in `scenarios.ts`: a
 * recording the background refused to save, because nothing a player could open was recorded
 * (Record and Stop at once with video on), is listed in the popup with Remove only. Retry save
 * would read the same chunks and refuse again, so the popup does not offer it.
 *
 * The test browser may not open the extension's pages, so the background opens the popup's page in
 * a tab and reads the newest recording's row (the `popup:recording-row` probe of test builds).
 */
import { z } from 'zod';
import { openMeeting, probe } from './harness';
import {
  recordAndStopAtOnce,
  type ScenarioContext,
  STOP_AT_ONCE_ATTEMPTS,
  waitForFinalized,
} from './scenarios';
import { meetingUrl } from './targets';

const videoModeSchema = z.object({ videoMode: z.string() });
const rowSchema = z.object({ text: z.string(), buttons: z.array(z.string()) });

export async function scenarioRefusedOnlyRemove({
  browser,
  target,
}: ScenarioContext): Promise<void> {
  console.log(
    `▶ ${target.id} scenario 53: a recording refused because nothing was recorded → the popup offers Remove, not Retry save`,
  );
  for (let attempt = 1; attempt <= STOP_AT_ONCE_ATTEMPTS; attempt++) {
    // A fresh page each time: Record then lands while the video encoder probe runs.
    const page = await openMeeting(browser, meetingUrl(target));
    try {
      if (!videoModeSchema.safeParse(await probe(page, 'settings:video-on')).success) {
        throw new Error('could not switch video on through the debug probe');
      }
      const id = await recordAndStopAtOnce(page);
      const [recording] = await waitForFinalized(page, [id]);
      if (recording?.status !== 'failed') {
        // Not a failure: a sample got in before the Stop, and the file was saved.
        console.log(`  attempt ${attempt}: ${id} was ${recording?.status}, a sample was recorded`);
        continue;
      }
      console.log(`  ${id}: failed (${recording.error})`);
      const answer = await probe(page, 'popup:recording-row');
      const row = rowSchema.safeParse(answer);
      if (!row.success) throw new Error(`popup:recording-row probe: ${JSON.stringify(answer)}`);
      const buttons = row.data.buttons.join(', ');
      console.log(`  the popup's row: "${row.data.text}", buttons: ${buttons || 'none'}`);
      if (!row.data.text.includes('failed: nothing was recorded')) {
        throw new Error(`the row does not say why nothing was saved: ${row.data.text}`);
      }
      if (buttons !== 'Remove') throw new Error(`the row offers ${buttons}, not Remove only`);
      return;
    } finally {
      await page.close();
    }
  }
  throw new Error(`every Stop came after the first sample (${STOP_AT_ONCE_ATTEMPTS} attempts)`);
}
