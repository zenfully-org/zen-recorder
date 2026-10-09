/**
 * E2e scenario 65, run against every provider's fixture page like the ones in `scenarios.ts`: the
 * download subfolder setting ends in an extension Firefox's downloads API turns into `.download`
 * (`meetings.local`), and a path it would change is refused. The recording is still saved, in the
 * folder `meetings_local`, and the setting is put back afterwards.
 */
import path from 'node:path';
import { z } from 'zod';
import {
  currentRecordingId,
  describeWebm,
  expectEqual,
  inspectWebm,
  listWebm,
  openMeeting,
  probe,
  sleep,
  waitFor,
  waitForNewRecording,
} from './harness';
import type { ScenarioContext } from './scenarios';
import { meetingUrl } from './targets';

const subfolderSchema = z.object({ downloadSubfolder: z.string() });
const recordingsSchema = z.object({
  recordings: z.array(
    z.object({
      id: z.string(),
      status: z.string(),
      error: z.string().optional(),
      filename: z.string().optional(),
    }),
  ),
});

export async function scenarioSubfolderExtension({
  browser,
  target,
}: ScenarioContext): Promise<void> {
  console.log(
    `▶ ${target.id} scenario 65: the download subfolder is "meetings.local", a name Firefox refuses → the recording is saved in "meetings_local"`,
  );
  const before = new Set(await listWebm());
  const page = await openMeeting(browser, meetingUrl(target));
  const set = subfolderSchema.safeParse(await probe(page, 'settings:subfolder-local'));
  if (!set.success || set.data.downloadSubfolder !== 'meetings.local') {
    throw new Error('could not set the download subfolder through the debug probe');
  }
  try {
    await page.click('#start');
    const id = await waitFor('recording', () => currentRecordingId(page), 20_000);
    await sleep(3_000);
    await page.evaluate(() => window.__fixture.clickOverlay('Stop'));
    const recording = await waitFor(
      `${id} saved or failed`,
      async () => {
        const { recordings } = recordingsSchema.parse(await probe(page, 'background:state'));
        const found = recordings.find((candidate) => candidate.id === id);
        return found?.status === 'saved' || found?.status === 'failed' ? found : null;
      },
      60_000,
    );
    const folder = recording.filename ? path.basename(path.dirname(recording.filename)) : '';
    console.log(
      `  ${id}: ${recording.status}${recording.error ? ` (${recording.error})` : ''}${folder ? `, in ${folder}/` : ''}`,
    );
    expectEqual(recording.status, 'saved', `status of ${id}`);
    expectEqual(folder, 'meetings_local', 'the folder it was saved in');
    const file = await waitForNewRecording(before);
    console.log(
      `  file: ${folder}/${path.basename(file)} → ${describeWebm(await inspectWebm(file))}`,
    );
  } finally {
    // The scenarios after this one save into the default folder.
    await probe(page, 'settings:subfolder-default');
    await page.close();
  }
}
