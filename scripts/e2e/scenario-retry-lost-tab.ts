/**
 * E2e scenario 52, run against every provider's fixture page like the ones in `scenarios.ts`: a
 * recording whose tab died without ending it is saved with "(recovered)" in its name, which says
 * the end of the meeting may be missing, also when it is saved from the popup.
 *   - Its save fails once (a download Firefox interrupts): the popup offers Retry save, the
 *     retried file is still named "(recovered)", and the saved recording no longer names the
 *     error of the save that failed.
 *   - Marking it interrupted fails (a full disk): it stays `recording` in the store, unsaved. A
 *     minute after its last chunk, the popup says so and offers Retry save and Remove instead of
 *     showing a live recording with no button, and Retry save saves it as recovered.
 *
 * The test browser may not open the extension's pages, so the background opens the popup's page in
 * a tab, reads the newest recording's row or clicks its button (`popup:recording-row`,
 * `popup:retry-save`). Every check is made and reported before the scenario fails, so one run of
 * an older build shows each thing it gets wrong.
 */
import path from 'node:path';
import type { Page } from 'puppeteer';
import { z } from 'zod';
import { dieLikeACrash } from './die-like-a-crash';
import { backgroundDiagnostics, currentRecordingId, openMeeting, probe, waitFor } from './harness';
import type { ScenarioContext } from './scenarios';
import { meetingUrl } from './targets';

const recordingsSchema = z.object({
  recordings: z.array(
    z.object({
      id: z.string(),
      status: z.string(),
      chunkCount: z.number(),
      error: z.string().optional(),
      // Absent from builds that do not report them.
      recovered: z.boolean().optional(),
      filename: z.string().optional(),
    }),
  ),
});
type StoredRecording = z.infer<typeof recordingsSchema>['recordings'][number];
const rowSchema = z.object({
  text: z.string(),
  buttons: z.array(z.string()),
  failure: z.string(),
});
type Row = z.infer<typeof rowSchema>;
const armedSchema = z.object({ armed: z.literal(true) });
const videoModeSchema = z.object({ videoMode: z.string() });

/** What the popup says of a recording left unsaved after its tab died. */
const LEFT_UNSAVED = 'not saved yet (tab closed)';
/** The background takes a recording as abandoned this long after its last chunk. */
const ABANDONED_AFTER_MS = 60_000;

const stored = async (control: Page, id: string): Promise<StoredRecording | undefined> =>
  recordingsSchema
    .parse(await probe(control, 'background:state'))
    .recordings.find((recording) => recording.id === id);

const readRow = async (control: Page, name: 'popup:recording-row' | 'popup:retry-save') => {
  const answer = await probe(control, name);
  const row = rowSchema.safeParse(answer);
  if (!row.success) throw new Error(`${name} probe: ${JSON.stringify(answer)}`);
  return row.data;
};

const describeRow = (row: Row): string =>
  `"${row.text}", buttons: ${row.buttons.join(', ') || 'none'}${row.failure ? `, says: ${row.failure}` : ''}`;

/** Joins a call in a new tab, waits until two chunks are stored, and returns the recording. */
async function recordInNewTab(
  { browser, target }: ScenarioContext,
  control: Page,
): Promise<{ page: Page; id: string }> {
  const page = await openMeeting(browser, meetingUrl(target));
  await page.click('#start');
  const id = await waitFor('recording', () => currentRecordingId(page), 20_000);
  await waitFor(
    'two chunks stored',
    async () => ((await stored(control, id))?.chunkCount ?? 0) > 1,
    20_000,
  );
  return { page, id };
}

/** The tab dies without a `pagehide` end, as a crash does. */
async function crash(page: Page): Promise<number> {
  await dieLikeACrash(page);
  await page.close();
  return Date.now();
}

/**
 * Checks the recording once it is saved: its file name says "(recovered)", and it names no error,
 * since the one of a save that failed before belongs to that save. Returns what went wrong.
 */
async function savedAsRecovered(control: Page, id: string, label: string): Promise<string[]> {
  const recording = await waitFor(
    `${id} saved`,
    async () => {
      const found = await stored(control, id);
      return found?.status === 'saved' ? found : null;
    },
    60_000,
  ).catch(async () => stored(control, id));
  const file =
    recording?.filename === undefined ? {} : { filename: path.basename(recording.filename) };
  console.log(`  ${label}: ${JSON.stringify({ ...recording, ...file })}`);
  if (recording?.status !== 'saved') return [`${label}: not saved (${recording?.status})`];
  return [
    ...(recording.filename?.includes('(recovered)')
      ? []
      : [`${label}: saved without "(recovered)" in its name: ${file.filename}`]),
    ...(recording.error === undefined
      ? []
      : [`${label}: saved, and still names the error of a save that failed: ${recording.error}`]),
  ];
}

/** Part 1: the recovered save fails once, and Retry save from the popup keeps "(recovered)". */
async function retryFailedRecoveredSave(
  context: ScenarioContext,
  control: Page,
): Promise<string[]> {
  const { page, id } = await recordInNewTab(context, control);
  armedSchema.parse(await probe(control, 'save:fail-next'));
  await crash(page);
  console.log(`  ${id}: its tab died; its save will fail once`);
  const failed = await waitFor(
    'the recovered save to fail',
    async () => {
      const recording = await stored(control, id);
      return recording?.status === 'failed' ? recording : null;
    },
    40_000,
  );
  console.log(`  ${id}: ${failed.status} (${failed.error}), recovered: ${failed.recovered}`);
  const row = await readRow(control, 'popup:retry-save');
  console.log(`  the popup's row before Retry save: ${describeRow(row)}`);
  return [
    ...(row.buttons.includes('Retry save') ? [] : ['the failed save offers no Retry save']),
    ...(await savedAsRecovered(control, id, 'the retried save')),
  ];
}

/**
 * Part 2: marking the recording interrupted fails, so it stays `recording`; a minute after its
 * last chunk the popup offers Retry save, which saves it as recovered.
 */
async function retryAbandonedRecording(context: ScenarioContext, control: Page): Promise<string[]> {
  const { page, id } = await recordInNewTab(context, control);
  armedSchema.parse(await probe(control, 'store:fail-next-interruption'));
  const diedAt = await crash(page);
  await waitFor(
    'the failed interruption in Diagnostics',
    async () =>
      (await backgroundDiagnostics(control)).some(
        (line) => line.includes('could not interrupt') && line.includes(id),
      ),
    40_000,
  );
  console.log(`  ${id}: its tab died, and marking it interrupted failed`);
  let row = await readRow(control, 'popup:recording-row');
  console.log(`  the popup's row at once: ${describeRow(row)}`);
  // The popup takes it as left unsaved only once its page can no longer deliver anything.
  row = await waitFor(
    `the row to say ${LEFT_UNSAVED}`,
    async () => {
      row = await readRow(control, 'popup:recording-row');
      return row.text.includes(LEFT_UNSAVED) ? row : null;
    },
    ABANDONED_AFTER_MS + 40_000,
  ).catch(() => row);
  const after = ((Date.now() - diedAt) / 1000).toFixed(0);
  console.log(`  the popup's row ${after} s after the tab died: ${describeRow(row)}`);
  const problems = [
    ...(row.text.includes(LEFT_UNSAVED) ? [] : [`the row never said "${LEFT_UNSAVED}"`]),
    ...(row.buttons.includes('Retry save') && row.buttons.includes('Remove')
      ? []
      : [`the row offers ${row.buttons.join(', ') || 'no button'}, not Retry save and Remove`]),
  ];
  if (!row.buttons.includes('Retry save')) {
    console.log(`  ${id}: ${JSON.stringify(await stored(control, id))}`);
    return problems;
  }
  const pressed = await readRow(control, 'popup:retry-save');
  if (pressed.failure) problems.push(`Retry save said: ${pressed.failure}`);
  return [...problems, ...(await savedAsRecovered(control, id, 'the abandoned recording'))];
}

export async function scenarioRetryLostTab(context: ScenarioContext): Promise<void> {
  const { browser, target } = context;
  console.log(
    `▶ ${target.id} scenario 52: a recording whose tab died is saved as "(recovered)" from the popup too: after a failed save, and when it was left unsaved`,
  );
  // Not in the call: it arms the faults and reads the background's state and the popup.
  const control = await openMeeting(browser, meetingUrl(target));
  const off = videoModeSchema.safeParse(await probe(control, 'settings:video-off'));
  if (!off.success || off.data.videoMode !== 'off') {
    throw new Error('could not switch video off through the debug probe');
  }
  try {
    const problems = [
      ...(await retryFailedRecoveredSave(context, control)),
      ...(await retryAbandonedRecording(context, control)),
    ];
    if (problems.length > 0) throw new Error(problems.join('; '));
  } finally {
    await probe(control, 'settings:video-on');
    await control.close();
  }
}
