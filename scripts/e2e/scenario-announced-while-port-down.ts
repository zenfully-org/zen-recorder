/**
 * E2e scenario 56, run against every provider's fixture page like the ones in `scenarios.ts`: a
 * recording starts and stops while the bridge's Port is down, as it is while the event page
 * restarts (held down here with the `ports:hold` probe). Its announcement never reaches the
 * background, and the page announces again only the recording it runs → once the Port is back,
 * the recording's end carries the announcement, and the recording is saved whole under its own
 * name. Before, the end found nothing stored about the recording, Diagnostics said "no file is
 * saved", and no file came.
 */
import path from 'node:path';
import {
  backgroundDiagnostics,
  currentRecordingId,
  describeWebm,
  ffprobe,
  inspectWebm,
  listWebm,
  newRecordings,
  openMeeting,
  probe,
  sleep,
  waitFor,
  waitForCompleteFile,
} from './harness';
import type { ScenarioContext } from './scenarios';
import { meetingUrl } from './targets';

export async function scenarioAnnouncedWhilePortDown({
  browser,
  target,
}: ScenarioContext): Promise<void> {
  console.log(
    `▶ ${target.id} scenario 56: a recording starts and stops while the bridge's Port is down → saved whole once the Port is back`,
  );
  const before = new Set(await listWebm());
  // Not in the call: it holds and releases the Ports through runtime messages, which need none.
  const control = await openMeeting(browser, meetingUrl(target));
  const page = await openMeeting(browser, meetingUrl(target));
  try {
    console.log(`  hold the Ports: ${JSON.stringify(await probe(control, 'ports:hold'))}`);
    await page.click('#start');
    const id = await waitFor('recording', () => currentRecordingId(page), 20_000);
    await sleep(4_000);
    await page.evaluate(() => window.__fixture.hangup());
    await waitFor('stopped', async () => (await currentRecordingId(page)) === null, 20_000);
    const releasedAt = Date.now();
    console.log(
      `  ${id} started and stopped while the Port was down; release the Ports: ${JSON.stringify(await probe(control, 'ports:release'))}`,
    );
    const outcome = await waitFor(
      'a saved file, or the end of a recording nothing is stored for',
      async () => {
        const [file] = await newRecordings(before);
        if (file) return { file };
        const refused = (await backgroundDiagnostics(control)).find((line) =>
          line.includes(`no file is saved for recording ${id}`),
        );
        return refused ? { refused } : null;
      },
      30_000,
    );
    if ('refused' in outcome) throw new Error(`no file was saved: ${outcome.refused}`);
    const file = await waitForCompleteFile(outcome.file);
    const info = await inspectWebm(file);
    console.log(
      `  saved ${((Date.now() - releasedAt) / 1000).toFixed(1)} s after the release as ${path.basename(file)} → ${describeWebm(info)}`,
    );
    console.log(`    ffprobe: ${ffprobe(file)}`);
    const problems: string[] = [];
    if (file.includes('(recovered)')) problems.push('saved as "(recovered)"');
    if (!(info.durationS > 3)) problems.push(`file too short (${info.durationS} s)`);
    await sleep(2_000);
    const files = (await newRecordings(before)).length;
    if (files !== 1) problems.push(`${files} files for one recording`);
    if (problems.length > 0) throw new Error(problems.join('; '));
  } finally {
    // Never leave the next scenario without a Port.
    await probe(control, 'ports:release');
    await page.close();
    await control.close();
  }
}
