/**
 * E2e scenario 35, run against every provider's fixture page: the first recording in a freshly
 * opened meeting page, which has no audio stream open yet → the file has the page's audio from its
 * first moment, not a second of silence while the browser opens the audio device.
 */
import path from 'node:path';
import { z } from 'zod';
import {
  describeWebm,
  ffprobe,
  inspectWebm,
  levelsOverTime,
  listWebm,
  openMeeting,
  pageDiagnostics,
  probe,
  recordingStarted,
  silences,
  sleep,
  waitFor,
  waitForNewRecording,
} from './harness';
import type { ScenarioContext, ScenarioRegistration } from './order-scenarios';
import { meetingUrl } from './targets';

const videoModeSchema = z.object({ videoMode: z.string() });

/** Seconds at the start of the file that must hold the page's audio in scenario 35. */
const FIRST_AUDIO_S = 3;

/**
 * Silence before the first audio buffer that scenario 35 accepts: the tap attaching takes
 * 0.03-0.07 s, a graph that still has to open the audio device 0.35 s and more.
 */
const MAX_AUDIO_LEAD_S = 0.15;

/**
 * How long scenario 35 stays on the page before joining, as a person does in the lobby: longer
 * than a page's first audio stream takes to open the audio device (up to 1.8 s in the lab).
 */
const LOBBY_MS = 3_000;

export async function scenarioFirstSecondsHaveAudio({
  browser,
  target,
}: ScenarioContext): Promise<void> {
  console.log(
    `▶ ${target.id} scenario 35: the first recording in a freshly opened meeting page → audio from its first moment`,
  );
  const before = new Set(await listWebm());
  const openedAt = Date.now();
  const page = await openMeeting(browser, meetingUrl(target));
  const result = videoModeSchema.safeParse(await probe(page, 'settings:video-on'));
  if (!result.success || result.data.videoMode !== 'tiles') {
    throw new Error('could not switch video on through the debug probe');
  }
  await sleep(LOBBY_MS);
  await page.click('#start');
  await waitFor('recording started', () => recordingStarted(page), 20_000);
  await sleep(6_000);
  await page.evaluate(() => {
    if (!window.__fixture.clickOverlay('Stop')) throw new Error('no Stop button');
  });
  const file = await waitForNewRecording(before);
  const lines = (await pageDiagnostics(page, openedAt)).filter(
    (line) => line.includes('audio starts') || line.includes('audio warm-up'),
  );
  const starts = lines.find((line) => line.includes('audio starts'));
  const lead = Number(/audio starts ([\d.]+) s/.exec(starts ?? '')?.[1]);
  const levels = levelsOverTime(file, 0, 5, 0.1);
  const gaps = silences(file, 0.3).filter(([start]) => start < FIRST_AUDIO_S);
  console.log(`  saved: ${path.basename(file)} → ${describeWebm(await inspectWebm(file))}`);
  console.log(`    ffprobe: ${ffprobe(file)}`);
  for (const line of lines) console.log(`  diagnostics: ${line}`);
  console.log(
    `  level per 100 ms over the first 5 s (dBFS): ${levels.map((level) => level.toFixed(0)).join(' ')}`,
  );
  console.log(`  silences ≥ 0.3 s in the first ${FIRST_AUDIO_S} s: ${JSON.stringify(gaps)}`);
  await page.close();
  const problems: string[] = [];
  if (!(lead <= MAX_AUDIO_LEAD_S)) {
    problems.push(
      `the audio starts ${Number.isNaN(lead) ? '(no "audio starts" line)' : `${lead} s`} into the recording: its audio graph was not running yet`,
    );
  }
  if (gaps.length > 0) {
    problems.push(`silent stretches in the first ${FIRST_AUDIO_S} s: ${JSON.stringify(gaps)}`);
  }
  if (problems.length > 0) throw new Error(problems.join('; '));
}

export const registration = {
  name: '35',
  // Early: the first recording of the browser, in a page whose window runs no audio graph yet.
  after: 'routing',
  scenario: scenarioFirstSecondsHaveAudio,
} satisfies ScenarioRegistration;
