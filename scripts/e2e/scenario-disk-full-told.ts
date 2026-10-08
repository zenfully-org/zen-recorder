/**
 * E2e scenario 44, run against every provider's fixture page like the ones in `scenarios.ts`: the
 * background cannot store a recording's chunks for a while, as on a full disk, twice → the meeting
 * tab that records shows one toast per outage, however often the page sends the chunk again, and
 * another meeting tab, idle, shows none; once storing works again the recording is saved whole.
 */
import path from 'node:path';
import type { Page } from 'puppeteer';
import { z } from 'zod';
import {
  backgroundDiagnostics,
  currentRecordingId,
  describeWebm,
  expectEqual,
  ffprobe,
  inspectWebm,
  listWebm,
  openMeeting,
  pageDiagnostics,
  probe,
  sleep,
  waitFor,
  waitForNewRecording,
} from './harness';
import type { ScenarioContext } from './scenarios';
import { meetingUrl } from './targets';

declare global {
  interface Window {
    /** Every toast the recorder's overlay showed since `watchToasts` ran. */
    __e2eToasts?: { kind: string; text: string }[];
  }
}

const recordingsSchema = z.object({
  recordings: z.array(
    z.object({ id: z.string(), status: z.string(), chunkCount: z.number(), byteSize: z.number() }),
  ),
});
const armedSchema = z.object({ armed: z.literal(true) });
const restoredSchema = z.object({ failed: z.number() });
const toastsSchema = z.array(z.object({ kind: z.string(), text: z.string() }));

/** Words of the toast that says the disk is full. */
const DISK_FULL = 'the disk is full';
/** The bridge gives up on an ack after 10 s, and the page sends the chunk again. */
const RESEND_MS = 13_000;

/** Records every toast the overlay shows: a toast leaves after a few seconds. */
async function watchToasts(page: Page): Promise<void> {
  await page.evaluate(() => {
    const toasts = document
      .querySelector('zen-recorder-overlay')
      ?.shadowRoot?.querySelector('.zr-toasts');
    if (!toasts) throw new Error('the overlay has no toast area');
    const seen: { kind: string; text: string }[] = [];
    window.__e2eToasts = seen;
    new MutationObserver((records) => {
      for (const node of records.flatMap((record) => [...record.addedNodes])) {
        if (node instanceof HTMLElement) {
          seen.push({ kind: node.dataset['kind'] ?? '', text: node.textContent ?? '' });
        }
      }
    }).observe(toasts, { childList: true });
  });
}

const toastsOf = async (page: Page) =>
  toastsSchema.parse(await page.evaluate(() => window.__e2eToasts ?? []));

const diskFullToasts = async (page: Page) =>
  (await toastsOf(page)).filter(
    (toast) => toast.kind === 'error' && toast.text.includes(DISK_FULL),
  );

export async function scenarioDiskFullTold({ browser, target }: ScenarioContext): Promise<void> {
  console.log(
    `▶ ${target.id} scenario 44: the disk is full twice → one toast per outage in the recording tab, none in another, one complete file`,
  );
  const before = new Set(await listWebm());
  // The idle tab first: the recording tab must be in front (Firefox defers device lists in a
  // background tab).
  const idle = await openMeeting(browser, meetingUrl(target));
  const page = await openMeeting(browser, meetingUrl(target));
  await watchToasts(idle);
  await watchToasts(page);
  const storedRecording = async (id: string) => {
    const { recordings } = recordingsSchema.parse(await probe(page, 'background:state'));
    return recordings.find((candidate) => candidate.id === id);
  };
  const storedChunks = async (id: string) => (await storedRecording(id))?.chunkCount ?? 0;

  await page.click('#start');
  const id = await waitFor('recording', () => currentRecordingId(page), 20_000);
  await waitFor('the first chunk stored', () => storedChunks(id), 15_000);

  const linesOf = async (file?: string) =>
    (await backgroundDiagnostics(page)).filter(
      (line) => line.includes(id) || (file !== undefined && line.includes(path.basename(file))),
    );

  /** One outage: the toast it shows, after the page sent the chunk at least `sends` times. */
  const outage = async (number: number, sends: number): Promise<void> => {
    armedSchema.parse(await probe(page, 'store:fail-chunks'));
    console.log(
      `  outage ${number}: every chunk fails to store (${await storedChunks(id)} stored)`,
    );
    await waitFor(
      `toast of outage ${number}`,
      async () => {
        const toasts = await diskFullToasts(page);
        return toasts.length >= number ? toasts : null;
      },
      20_000,
    ).catch(async (error: unknown) => {
      // The store works again for the scenarios after this one.
      await probe(page, 'store:restore-chunks');
      for (const line of (await linesOf()).slice(-6)) console.log(`  diagnostics: ${line}`);
      console.log(`  toasts in the recording tab: ${JSON.stringify(await toastsOf(page))}`);
      throw error;
    });
    await sleep(RESEND_MS * (sends - 1));
    const { failed } = restoredSchema.parse(await probe(page, 'store:restore-chunks'));
    console.log(`  outage ${number} over: ${failed} chunk sends failed`);
    if (failed < sends) throw new Error(`only ${failed} chunk sends failed, expected ${sends}`);
    expectEqual((await diskFullToasts(page)).length, number, `toasts after outage ${number}`);
    // The chunk that failed is sent again and stored: storing worked between the two outages.
    const storedAtRestore = await storedChunks(id);
    await waitFor(
      `a chunk stored after outage ${number}`,
      async () => (await storedChunks(id)) > storedAtRestore,
      20_000,
    );
  };
  // The first outage lasts through a send again, which must not toast a second time.
  await outage(1, 2);
  await outage(2, 1);

  await page.evaluate(() => window.__fixture.clickOverlay('Stop'));
  const saved = await waitForNewRecording(before).catch(async (error: unknown) => {
    console.log(`  60 s after Stop: ${JSON.stringify(await storedRecording(id))}`);
    for (const line of await linesOf()) console.log(`  diagnostics: ${line}`);
    throw error;
  });
  const lines = await linesOf(saved);
  const pageEnd = (await pageDiagnostics(page)).findLast((line) =>
    line.includes('recording ended'),
  );
  for (const line of [...lines.slice(-6), pageEnd ?? '(no page line)'].sort()) {
    console.log(`  diagnostics: ${line}`);
  }
  for (const [name, tab] of [
    ['recording tab', page],
    ['idle tab', idle],
  ] as const) {
    for (const toast of await toastsOf(tab))
      console.log(`  ${name} toast (${toast.kind}): ${toast.text}`);
  }
  const info = await inspectWebm(saved);
  console.log(`  file: ${path.basename(saved)} → ${describeWebm(info)}`);
  console.log(`    ffprobe: ${ffprobe(saved)}`);

  expectEqual((await diskFullToasts(page)).length, 2, 'disk-full toasts in the recording tab');
  expectEqual((await diskFullToasts(idle)).length, 0, 'disk-full toasts in the idle tab');
  // Every chunk the page recorded is in the file: the ones that failed were stored when resent.
  const recorded = pageEnd?.match(/after (\d+) chunks/)?.[1];
  const joined = lines.map((line) => line.match(/ info: saved .* \((\d+) chunks, /)?.[1]);
  expectEqual(joined.find(Boolean), recorded, 'chunks in the file (the page recorded)');
  expectEqual((await storedRecording(id))?.status, 'saved', 'status of the recording');
  if (!(info.durationS > 20)) throw new Error(`file too short: ${info.durationS} s`);
  if (!info.video) throw new Error('the file has no video track');
  await page.close();
  await idle.close();
}
