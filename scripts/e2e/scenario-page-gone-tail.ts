/**
 * E2e scenario 47, run against every provider's fixture page like the ones in `scenarios.ts`: the
 * page goes away (a navigation, a closed tab) while the recorder holds seconds it has not handed
 * over yet → the file reaches the moment the page went away. The page leaves 2.3 s after a chunk
 * boundary, when the encoder's current batch holds the most. With video (WebCodecs) the file must
 * end within a second of that moment; audio alone (MediaRecorder) hands its last data over only in
 * a later task, so it may lose that batch, but never more.
 */
import path from 'node:path';
import type { Page } from 'puppeteer';
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
  recordingStartedAt,
  sleep,
  waitFor,
  waitForNewRecording,
} from './harness';
import type { ScenarioContext } from './scenarios';
import { meetingUrl } from './targets';

const recordingsSchema = z.object({
  recordings: z.array(z.object({ id: z.string(), status: z.string(), chunkCount: z.number() })),
});
const videoModeSchema = z.object({ videoMode: z.string() });

/** How long after a chunk boundary the page goes away: most of a 3 s batch is still in the page. */
const AFTER_BOUNDARY_MS = 2_300;
/** What a file with video may miss of the time before the page went away. */
const VIDEO_TAIL_S = 1;
/** Audio alone may miss its current batch (3 s by default), never more. */
const AUDIO_TAIL_S = 3.5;

interface Case {
  label: string;
  video: boolean;
  goAway: (page: Page) => Promise<number>;
}

const CASES: Case[] = [
  {
    label: 'with video, navigated away',
    video: true,
    goAway: (page) =>
      page.evaluate(() => {
        const at = Date.now();
        location.assign('about:blank');
        return at;
      }),
  },
  {
    label: 'with video, tab closed',
    video: true,
    goAway: async (page) => {
      const at = Date.now();
      await page.close();
      return at;
    },
  },
  {
    label: 'audio only, tab closed',
    video: false,
    goAway: async (page) => {
      const at = Date.now();
      await page.close();
      return at;
    },
  },
];

/** Waits for the next chunk of `id` to be stored: a batch boundary, give or take the relay. */
async function nextBoundary(control: Page, id: string): Promise<void> {
  const count = async () =>
    recordingsSchema
      .parse(await probe(control, 'background:state'))
      .recordings.find((r) => r.id === id)?.chunkCount ?? 0;
  const seen = await count();
  await waitFor('the next chunk stored', async () => (await count()) > seen, 10_000);
}

/** Records in a fresh meeting tab, lets `goAway` end it after a boundary, returns what was lost. */
async function runCase(
  browser: ScenarioContext['browser'],
  url: string,
  control: Page,
  item: Case,
) {
  const before = new Set(await listWebm());
  const since = new Date().toISOString().slice(11, 23);
  const page = await openMeeting(browser, url);
  await page.click('#start');
  const id = await waitFor('recording', () => currentRecordingId(page), 20_000);
  const startedAt = await recordingStartedAt(page);
  // Two boundaries: the first chunk may come early while the probe settles.
  await nextBoundary(control, id);
  await nextBoundary(control, id);
  await sleep(AFTER_BOUNDARY_MS);
  const goneAt = await item.goAway(page);
  const file = await waitForNewRecording(before);
  const info = await inspectWebm(file);
  const recordedS = (goneAt - startedAt) / 1000;
  const lostS = recordedS - info.durationS;
  const early = (await backgroundDiagnostics(control)).filter(
    (line) => line.slice(0, 12) >= since && line.includes('the file ends early'),
  );
  console.log(
    `  ${item.label}: ${path.basename(file)} → ${describeWebm(info)}; the page went away ${recordedS.toFixed(2)} s in, the file ends ${lostS.toFixed(2)} s before`,
  );
  for (const line of early) console.log(`    diagnostics: ${line}`);
  await sleep(1_500);
  const files = (await newRecordings(before)).length;
  if (!page.isClosed()) await page.close();
  const limit = item.video ? VIDEO_TAIL_S : AUDIO_TAIL_S;
  return [
    ...(lostS > limit
      ? [`${item.label}: the file ends ${lostS.toFixed(2)} s before the page went away`]
      : []),
    ...(file.includes('(recovered)') ? [`${item.label}: saved as "(recovered)"`] : []),
    ...(early.length > 0 ? [`${item.label}: ${early[0]}`] : []),
    ...(files !== 1 ? [`${item.label}: ${files} files for one recording`] : []),
  ];
}

export async function scenarioPageGoneTail({ browser, target }: ScenarioContext): Promise<void> {
  console.log(
    `▶ ${target.id} scenario 47: the page goes away while the recorder holds seconds it has not handed over → the file reaches that moment`,
  );
  const url = meetingUrl(target);
  // Not in the call: it reads the background's state and switches video on and off.
  const control = await openMeeting(browser, url);
  const problems: string[] = [];
  try {
    for (const item of CASES) {
      const mode = videoModeSchema.parse(
        await probe(control, item.video ? 'settings:video-on' : 'settings:video-off'),
      );
      if ((mode.videoMode !== 'off') !== item.video)
        throw new Error(`video mode ${mode.videoMode}`);
      problems.push(...(await runCase(browser, url, control, item)));
    }
  } finally {
    await probe(control, 'settings:video-on');
  }
  await control.close();
  if (problems.length > 0) throw new Error(problems.join('; '));
}
