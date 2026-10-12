/**
 * E2e scenario 78, run against every provider's fixture page like the ones in `scenarios.ts`: the
 * recorder's clock says where the recording is in its saved file, pauses left out, with video
 * (WebCodecs) and without (MediaRecorder).
 *
 * Meeting notes place every event by this clock, so a reader can seek to it. The wall clock cannot
 * do it: a pause is in the wall time and not in the file, and so are the seconds a cold audio
 * graph takes to start (1.5-1.8 s on CI's machines), which a MediaRecorder file leaves out.
 *
 *   - The page records, pauses for 3 s and goes on. Across the pause the clock must move by the
 *     wall time minus the pause, within 1 s. Measured from the recording's start, the wall time
 *     would also hold a cold graph's late start.
 *   - The microphone is muted after the pause and unmuted where the clock says X: the microphone's
 *     tone must be missing from the file just before X and back just after it.
 *   - The stop, where the notes place it, must be within 50 ms of the end of the file: the clock
 *     when the page handled the Stop (the stop event the page stamped) and the position the notes
 *     file gives it. The clock read right before the click is only logged: on a busy page the
 *     click reaches the recorder later, and the file rightly ends there (CI's runners read it up
 *     to 40 ms before the end). The audio ends on a 20 ms Opus frame, and the clock reads the audio
 *     graph through a busy main thread: 50 ms leaves room for both. Audio from after the Stop in
 *     the file fails it: a ScriptProcessor tap lets in the rest of its 341 ms buffer, and its files
 *     ran 140-300 ms past the stop.
 */
import path from 'node:path';
import type { Page } from 'puppeteer';
import { z } from 'zod';
import {
  currentRecordingId,
  describeWebm,
  inspectWebm,
  listWebm,
  openMeeting,
  overlayState,
  pressCardButton,
  probe,
  recordingStarted,
  recordingStartedAt,
  sleep,
  toneLevel,
  waitFor,
  waitForNewRecording,
} from './harness';
import { waitForNotes } from './notes-files';
import type { ScenarioContext } from './scenarios';
import { type FixtureTarget, meetingUrl } from './targets';

/** The fixtures' fake microphone. */
const MIC_TONE_HZ = 1000;
const PAUSE_MS = 3_000;
/** How far the clock's move across the pause may be from the wall's. */
const PAUSE_TOLERANCE_MS = 1_000;
/** How far the stop, where the notes place it, may be from the end of the file. */
const STOP_TOLERANCE_MS = 50;
const clockSchema = z.object({
  clock: z.object({ mediaMs: z.number(), paused: z.boolean() }).nullable(),
});
const storedEventsSchema = z.object({
  recording: z.object({ id: z.string() }),
  events: z.array(z.object({ type: z.string(), mediaMs: z.number() })),
});

async function readClockMs(page: Page): Promise<number> {
  const debug = clockSchema.safeParse(await page.evaluate(() => window.__zenRecorderPage?.debug()));
  const clock = debug.success ? debug.data.clock : null;
  if (!clock) throw new Error('the page reports no clock while recording (debug().clock)');
  return clock.mediaMs;
}

/** The stop event the page stamped for `recordingId`, as stored: the clock when it handled Stop. */
async function storedStopMs(page: Page, recordingId: string): Promise<number> {
  const stop = await waitFor(
    `the stored stop of ${recordingId}`,
    async () => {
      const stored = storedEventsSchema.safeParse(await probe(page, 'notes:events'));
      if (!stored.success || stored.data.recording.id !== recordingId) return null;
      return stored.data.events.find((event) => event.type === 'recording-stopped');
    },
    20_000,
    async () => JSON.stringify(await probe(page, 'notes:events')),
  );
  return stop.mediaMs;
}

/**
 * Runs `fn` with the next save held: the background deletes a recording's events once its notes
 * are written, so a stored event is read while its recording waits to be saved.
 */
async function withSaveHeld<T>(page: Page, fn: () => Promise<T>): Promise<T> {
  await probe(page, 'save:hold-next');
  try {
    return await fn();
  } finally {
    await probe(page, 'save:release');
  }
}

/** What is wrong with the stop, as the page stamped it and as the notes place it, at `fileMs`. */
function stopProblems(stopMs: number, notesMs: number | undefined, fileMs: number): string[] {
  const off = (ms: number): string | null => {
    const delta = ms - fileMs;
    return Math.abs(delta) > STOP_TOLERANCE_MS ? `${delta.toFixed(0)} ms` : null;
  };
  const clock = off(stopMs);
  const notes = notesMs === undefined ? null : off(notesMs);
  return [
    ...(clock ? [`the clock at the stop is ${clock} off the end of the file`] : []),
    ...(notesMs === undefined ? ['the notes have no stop'] : []),
    ...(notes ? [`the notes place the stop ${notes} off the end of the file`] : []),
  ];
}

async function press(page: Page, button: 'Pause' | 'Resume', state: string): Promise<void> {
  await pressCardButton(page, button);
  await waitFor(state, async () => (await overlayState(page)) === state, 5_000);
}

/** Records with a pause and a mute; checks the clock against the file and the notes. */
async function recordOnce(page: Page, before: ReadonlySet<string>, label: string): Promise<void> {
  await page.click('#start');
  await waitFor('recording', async () => (await overlayState(page)) === 'recording', 20_000);
  await waitFor('encoder started', () => recordingStarted(page), 20_000);
  const startedAt = await recordingStartedAt(page);
  const recordingId = await waitFor('a recording id', () => currentRecordingId(page), 5_000);
  await sleep(3_000);
  const beforePause = { clock: await readClockMs(page), wall: Date.now() };
  await press(page, 'Pause', 'paused');
  const pausedAt = Date.now();
  await sleep(PAUSE_MS);
  await press(page, 'Resume', 'recording');
  const pausedMs = Date.now() - pausedAt;
  const afterPause = { clock: await readClockMs(page), wall: Date.now() };
  // What the clock moved across the pause, less what the wall moved outside it.
  const pauseError =
    afterPause.clock - beforePause.clock - (afterPause.wall - beforePause.wall - pausedMs);
  await sleep(1_000);
  await page.evaluate(() => window.__fixture.mute());
  await sleep(2_000);
  const unmutedAtMs = await readClockMs(page);
  await page.evaluate(() => window.__fixture.unmute());
  const { clockMs, wallMs, stopMs } = await withSaveHeld(page, async () => {
    await sleep(2_500);
    const read = { clockMs: await readClockMs(page), wallMs: Date.now() - startedAt };
    await pressCardButton(page, 'Stop');
    return { ...read, stopMs: await storedStopMs(page, recordingId) };
  });
  const file = await waitForNewRecording(before);
  const info = await inspectWebm(file);
  const fileMs = info.durationS * 1000;
  const { document } = await waitForNotes(file);
  const notesStop = document.events.find((event) => event.type === 'recording-stopped');
  console.log(`  ${label}: file ${path.basename(file)} → ${describeWebm(info)}`);
  console.log(
    `  ${label}: stop at ${stopMs.toFixed(0)} ms, file ${fileMs.toFixed(0)} ms (Δ ${(stopMs - fileMs).toFixed(0)}); the notes place it at ${notesStop?.mediaMs ?? '?'} ms${notesStop?.clamped ? ' (clamped)' : ''} in ${document.recording.durationMs ?? '?'} ms; the clock read ${clockMs.toFixed(0)} ms right before the click`,
  );
  console.log(
    `  ${label}: wall ${wallMs} ms − clock = ${(wallMs - clockMs).toFixed(0)} ms, paused ${pausedMs} ms; across the pause the clock is ${pauseError.toFixed(0)} ms off the wall`,
  );
  const at = unmutedAtMs / 1000;
  const muted = toneLevel(file, MIC_TONE_HZ, at - 1.5, at - 0.5);
  const live = toneLevel(file, MIC_TONE_HZ, at + 0.5, at + 1.5);
  console.log(
    `  ${label}: microphone unmuted at ${at.toFixed(2)} s by the clock: ${muted.toFixed(1)} dBFS before, ${live.toFixed(1)} dBFS after`,
  );
  const problems = [
    ...stopProblems(stopMs, notesStop?.mediaMs, fileMs),
    ...(Math.abs(pauseError) > PAUSE_TOLERANCE_MS ? ['the clock counts the pause'] : []),
    ...(muted < -50 && live > -40
      ? []
      : ['the microphone does not come back where the clock says']),
  ];
  if (problems.length > 0) throw new Error(`${label}: ${problems.join('; ')}`);
}

/** With video, then without (the setting switched off on the page for the time of the run). */
export async function scenarioMediaClock({ browser, target }: ScenarioContext): Promise<void> {
  console.log(`▶ ${target.id} scenario 78: the clock says where the recording is in its file`);
  await recordMode(browser, target, 'with video', false);
  await recordMode(browser, target, 'audio only', true);
}

async function recordMode(
  browser: ScenarioContext['browser'],
  target: FixtureTarget,
  label: string,
  videoOff: boolean,
): Promise<void> {
  const before = new Set(await listWebm());
  const page = await openMeeting(browser, meetingUrl(target));
  try {
    if (videoOff) await probe(page, 'settings:video-off');
    await recordOnce(page, before, label);
  } finally {
    if (videoOff) await probe(page, 'settings:video-on');
  }
  await page.close();
}
