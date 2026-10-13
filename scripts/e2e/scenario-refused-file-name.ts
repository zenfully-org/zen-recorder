/**
 * E2e scenario 11, run against every provider's fixture page: a meeting title Firefox refuses as a
 * file name, then a name Firefox refuses anyway → each recording saved as one file, the second
 * under the dated fallback name.
 */
import path from 'node:path';
import type { Page } from 'puppeteer';
import { z } from 'zod';
import {
  backgroundDiagnostics,
  currentRecordingId,
  describeWebm,
  expectEqual,
  inspectWebm,
  listWebm,
  newRecordings,
  openMeeting,
  pressCardButton,
  probe,
  sleep,
  waitFor,
  waitForCompleteFile,
} from './harness';
import type { ScenarioContext, ScenarioRegistration } from './order-scenarios';
import { meetingUrl } from './targets';
import { waitForFinalized } from './wait-for-finalized';

const videoModeSchema = z.object({ videoMode: z.string() });

/** A title Firefox refuses as a file name: a joined emoji and right-to-left marks. */
const REFUSED_TITLE = 'Dev 👨\u200D💻 sync \u200Fשלום\u200F';

/** The same title in a file name: the joiner and the marks dropped, the emoji kept. */
const REFUSED_TITLE_SAVED = 'Dev 👨💻 sync שלום';

const FALLBACK_NAME_RE = /^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}_recording(?:\(\d+\))?\.webm$/;

/** Stops the page's recording `id`, waits until it is finalized and prints what it left. */
async function stopAndCollect(page: Page, id: string, before: ReadonlySet<string>) {
  await sleep(4_000);
  const stoppedAt = new Date().toISOString().slice(11, 23);
  await pressCardButton(page, 'Stop');
  const [recording] = await waitForFinalized(page, [id]);
  if (!recording) throw new Error(`recording ${id} not finalized`);
  console.log(`  ${id}: ${recording.status}${recording.error ? ` (${recording.error})` : ''}`);
  // Lines start with their UTC time: only the ones written since Stop.
  const lines = (await backgroundDiagnostics(page)).filter(
    (line) => line.slice(0, 12) >= stoppedAt,
  );
  for (const line of lines) console.log(`  diagnostics: ${line}`);
  await sleep(1_000);
  const files = await newRecordings(before);
  if (files.length === 0) console.log('  no file saved');
  for (const file of files) {
    const info = await inspectWebm(await waitForCompleteFile(file));
    console.log(`  file: ${path.basename(file)} → ${describeWebm(info)}`);
    if (!(info.durationS > 2)) throw new Error(`file too short: ${info.durationS} s`);
  }
  return { recording, lines, names: files.map((file) => path.basename(file)) };
}

export async function scenarioRefusedFileName({ browser, target }: ScenarioContext): Promise<void> {
  console.log(
    `▶ ${target.id} scenario 11: a title Firefox refuses as a file name, then a refused name → saved`,
  );
  const page = await openMeeting(browser, meetingUrl(target));
  try {
    const result = videoModeSchema.safeParse(await probe(page, 'settings:video-off'));
    if (!result.success || result.data.videoMode !== 'off') {
      throw new Error('could not switch video off through the debug probe');
    }
    await page.evaluate((title) => window.__fixture.setTitle(title), REFUSED_TITLE);
    let before = new Set(await listWebm());
    await page.click('#start');
    const titled = await waitFor('recording', () => currentRecordingId(page), 20_000);
    const first = await stopAndCollect(page, titled, before);
    expectEqual(first.recording.status, 'saved', `status of ${titled}`);
    expectEqual(first.names.length, 1, 'files saved for the titled recording');
    const [name] = first.names;
    if (!name?.includes(REFUSED_TITLE_SAVED) || /\p{Cf}/u.test(name)) {
      throw new Error(`unexpected file name ${JSON.stringify(name)}`);
    }

    // A name Firefox refuses anyway (one the sanitizer missed) → saved once under the fallback.
    before = new Set(await listWebm());
    const armed = z
      .object({ armed: z.literal(true) })
      .safeParse(await probe(page, 'save:refuse-next-name'));
    if (!armed.success) throw new Error('could not arm the name refusal through the debug probe');
    await pressCardButton(page, 'Record');
    const refused = await waitFor(
      'the next recording',
      async () => {
        const id = await currentRecordingId(page);
        return id !== titled && id;
      },
      20_000,
    );
    const second = await stopAndCollect(page, refused, before);
    expectEqual(second.recording.status, 'saved', `status of ${refused}`);
    expectEqual(second.names.length, 1, 'files saved for the refused recording');
    if (!FALLBACK_NAME_RE.test(second.names[0] ?? '')) {
      throw new Error(`not the fallback name: ${JSON.stringify(second.names[0])}`);
    }
    if (!second.lines.some((line) => line.includes('Firefox refused the file name'))) {
      throw new Error('no "Firefox refused the file name" line in Diagnostics');
    }
  } finally {
    await probe(page, 'settings:video-on');
  }
  await page.close();
}

export const registration = {
  name: '11',
  after: '70',
  scenario: scenarioRefusedFileName,
} satisfies ScenarioRegistration;
