/**
 * E2e scenario 78, run against every provider's fixture page: the recorder's clock says where the
 * recording is in its saved file, pauses left out, with video (WebCodecs) and without
 * (MediaRecorder), and with video through the audio tap's fallback, a ScriptProcessorNode, which
 * records wherever no AudioWorklet module loads (forced here by deleting `window.AudioWorkletNode`,
 * which the recorder reads when a recording starts).
 *
 * Meeting notes place every event by this clock, so a reader can seek to it. The wall clock cannot
 * do it: a pause is in the wall time and not in the file, and so are the seconds a cold audio
 * graph takes to start (1.5-1.8 s on CI's machines), which a MediaRecorder file leaves out.
 *
 *   - The page records, pauses for 3 s and goes on. Across the pause the clock must move by the
 *     wall time minus the pause, within 1 s. Measured from the recording's start, the wall time
 *     would also hold a cold graph's late start.
 *   - Where the pause was cut out of the file (its place in the notes), the audio must go on with
 *     no silence longer than `GAP_TOLERANCE_MS`: audio lost after the Resume is silence there, as
 *     the clock fills the time it misses. Audio of the pause kept in the file instead moves all
 *     that follows later, which the stop's check below sees. A ScriptProcessor hands the page
 *     341 ms buffers and the tap cuts the one that holds a click; without the cut, a Resume lost
 *     up to a buffer, and a Pause and a Stop kept up to one.
 *   - The microphone is muted after the pause and unmuted where the clock says X: the microphone's
 *     tone must be missing from the file just before X and back just after it.
 *   - The stop, where the notes place it, must be within 50 ms of the end of the file: the clock
 *     when the page handled the Stop (the stop event the page stamped) and the position the notes
 *     file gives it. The clock read right before the click is only logged: on a busy page the
 *     click reaches the recorder later, and the file rightly ends there (CI's runners read it up
 *     to 40 ms before the end). The audio ends on a 20 ms Opus frame, and the clock reads the audio
 *     graph through a busy main thread: 50 ms leaves room for both. Audio from after the Stop in
 *     the file fails it: a ScriptProcessor that kept the rest of its 341 ms buffer ran 140-300 ms
 *     past the stop.
 */
import path from 'node:path';
import type { Page } from 'puppeteer';
import { z } from 'zod';
import {
  currentRecordingId,
  describeWebm,
  inspectWebm,
  levelsOverTime,
  listWebm,
  openMeeting,
  overlayState,
  pageDiagnostics,
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
import type { ScenarioContext, ScenarioRegistration } from './order-scenarios';
import { type FixtureTarget, meetingUrl } from './targets';

/** The fixtures' fake microphone. */
const MIC_TONE_HZ = 1000;
const PAUSE_MS = 3_000;
/** How far the clock's move across the pause may be from the wall's. */
const PAUSE_TOLERANCE_MS = 1_000;
/** How far the stop, where the notes place it, may be from the end of the file. */
const STOP_TOLERANCE_MS = 50;
/** How long a silence the file may hold where the pause was cut out (an Opus frame is 20 ms). */
const GAP_TOLERANCE_MS = 30;
/** The slices the level is measured in around the pause, and the level of silence. */
const SLICE_S = 0.01;
const SILENT_DBFS = -50;
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

/**
 * Milliseconds of silence in the file from 0.2 s before the pause's place (`pauseS`) to 0.6 s
 * after it, in slices of `SLICE_S`: the call's two tones play throughout, so none is expected.
 */
function silenceAtPause(file: string, pauseS: number): number {
  const levels = levelsOverTime(file, pauseS - 0.2, pauseS + 0.6, SLICE_S);
  return levels.filter((level) => level < SILENT_DBFS).length * SLICE_S * 1000;
}

/** Records with a pause and a mute; checks the clock against the file and the notes. */
async function recordOnce(page: Page, before: ReadonlySet<string>, label: string): Promise<void> {
  const since = Date.now();
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
  const notesPause = document.events.find((event) => event.type === 'recording-paused');
  const tap = (await pageDiagnostics(page, since)).filter((line) => line.includes(': audio tap'));
  console.log(
    `  ${label}: file ${path.basename(file)} → ${describeWebm(info)} (${tap.join('; ')})`,
  );
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
  const gapMs = notesPause ? silenceAtPause(file, notesPause.mediaMs / 1000) : null;
  console.log(
    `  ${label}: where the pause was cut out, at ${notesPause?.mediaMs ?? '?'} ms, the file holds ${gapMs ?? '?'} ms of silence`,
  );
  const problems = [
    ...stopProblems(stopMs, notesStop?.mediaMs, fileMs),
    ...(gapMs === null ? ['the notes have no pause'] : []),
    ...(gapMs !== null && gapMs > GAP_TOLERANCE_MS
      ? [`${gapMs} ms of silence where the pause was cut out: audio lost after the Resume`]
      : []),
    ...(Math.abs(pauseError) > PAUSE_TOLERANCE_MS ? ['the clock counts the pause'] : []),
    ...(muted < -50 && live > -40
      ? []
      : ['the microphone does not come back where the clock says']),
  ];
  if (problems.length > 0) throw new Error(`${label}: ${problems.join('; ')}`);
}

/**
 * With video, without (the setting switched off on the page for the time of the run), and with
 * video through the ScriptProcessor.
 */
export async function scenarioMediaClock({ browser, target }: ScenarioContext): Promise<void> {
  console.log(`▶ ${target.id} scenario 78: the clock says where the recording is in its file`);
  await recordMode(browser, target, 'with video', 'video');
  await recordMode(browser, target, 'audio only', 'audio only');
  await recordMode(browser, target, 'with video, ScriptProcessor', 'processor');
}

async function recordMode(
  browser: ScenarioContext['browser'],
  target: FixtureTarget,
  label: string,
  mode: 'video' | 'audio only' | 'processor',
): Promise<void> {
  const before = new Set(await listWebm());
  const page = await openMeeting(browser, meetingUrl(target));
  const since = Date.now();
  try {
    if (mode === 'audio only') await probe(page, 'settings:video-off');
    if (mode === 'processor') {
      await page.evaluate(() => Reflect.deleteProperty(window, 'AudioWorkletNode'));
    }
    await recordOnce(page, before, label);
  } finally {
    if (mode === 'audio only') await probe(page, 'settings:video-on');
  }
  if (mode === 'processor') {
    const lines = await pageDiagnostics(page, since);
    if (!lines.some((line) => line.endsWith(': audio tap: processor'))) {
      throw new Error(
        `${label}: the recorder did not take its ScriptProcessor (${lines.join('; ')})`,
      );
    }
  }
  await page.close();
}

export const registration = {
  name: '78',
  after: '73',
  scenario: scenarioMediaClock,
} satisfies ScenarioRegistration;
