/**
 * E2e scenario 54, run against every provider's fixture page like the ones in `scenarios.ts`: a
 * meeting tab is closed while it records, and the end its bridge posts in `pagehide` never reaches
 * the background, as Firefox can drop that message on a busy machine → the background ends the
 * recording once the browser reports the tab removed: one file, saved within seconds under its
 * own name, not as "(recovered)" once the grace for a lost tab is over, and Diagnostics say why.
 */
import path from 'node:path';
import { z } from 'zod';
import {
  backgroundDiagnostics,
  currentRecordingId,
  describeWebm,
  inspectWebm,
  listWebm,
  newRecordings,
  openMeeting,
  probe,
  sleep,
  waitFor,
  waitForNewRecording,
} from './harness';
import type { ScenarioContext } from './scenarios';
import { meetingUrl } from './targets';

const recordingsSchema = z.object({
  recordings: z.array(z.object({ id: z.string(), status: z.string(), chunkCount: z.number() })),
});

/** The background gives a lost tab 10 s to come back; a closed one does not need them. */
const SAVED_WITHIN_S = 6;

export async function scenarioClosedTabEndLost({
  browser,
  target,
}: ScenarioContext): Promise<void> {
  console.log(
    `▶ ${target.id} scenario 54: a tab closes while it records and its pagehide end is lost → saved at once under its own name`,
  );
  const before = new Set(await listWebm());
  // Not in the call: it reads the background's state once the meeting tab is gone.
  const control = await openMeeting(browser, meetingUrl(target));
  const page = await openMeeting(browser, meetingUrl(target));
  await page.click('#start');
  const id = await waitFor('recording', () => currentRecordingId(page), 20_000);
  const stored = async () =>
    recordingsSchema
      .parse(await probe(control, 'background:state'))
      .recordings.find((recording) => recording.id === id);
  await waitFor('two chunks stored', async () => ((await stored())?.chunkCount ?? 0) > 1, 20_000);
  z.object({ endOnPageHide: z.literal(false) }).parse(await probe(page, 'bridge:no-pagehide-end'));
  const closedAt = Date.now();
  await page.close();

  const file = await waitForNewRecording(before);
  const savedAfterS = (Date.now() - closedAt) / 1000;
  const status = await waitFor(
    'the recording marked saved',
    async () => ((await stored())?.status === 'saved' ? 'saved' : null),
    10_000,
  ).catch(async () => (await stored())?.status);
  const info = await inspectWebm(file);
  console.log(
    `  saved ${savedAfterS.toFixed(1)} s after the tab closed: ${path.basename(file)} → ${describeWebm(info)}`,
  );
  const line = (await backgroundDiagnostics(control)).find((candidate) =>
    candidate.includes(`recording ${id} was closed`),
  );
  console.log(`  diagnostics: ${line ?? '(nothing about the closed tab)'}`);

  const problems: string[] = [];
  if (file.includes('(recovered)')) problems.push('saved as "(recovered)"');
  if (savedAfterS > SAVED_WITHIN_S) {
    problems.push(`saved ${savedAfterS.toFixed(1)} s after the tab closed`);
  }
  if (status !== 'saved') problems.push(`status ${status}`);
  if (!line) problems.push('Diagnostics do not say the tab was closed before its end arrived');
  if (!(info.durationS > 3)) problems.push(`file too short: ${info.durationS} s`);
  await sleep(2_000);
  const files = (await newRecordings(before)).length;
  if (files !== 1) problems.push(`${files} files for one recording`);
  await control.close();
  if (problems.length > 0) throw new Error(problems.join('; '));
}
