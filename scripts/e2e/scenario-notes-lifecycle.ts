/**
 * E2e scenario 96, run against every provider's fixture page right after scenario 90: the meeting
 * notes say why each recording started, what it records, and which file of the meeting it goes on
 * from.
 *
 *   - One call: the recording starts by itself once someone else is in the call, with video. The
 *     video encoder fails: the first file's timeline says the video failed right before its stop
 *     (`encoder-error`), and the recorder goes on at once in a second file, audio only, whose notes
 *     say it restarted after the video failed and continue the first file by name, with the wall
 *     time between the two. Stop, then Record: a third file, started by hand, still audio only
 *     (the video failed in this meeting), continues the second.
 *   - A new tab with video off in Options: the recording is audio only because of the setting, and
 *     continues nothing (another page).
 *   - A call paused for 4 s: the notes say when it paused and resumed, both where the pause cut the
 *     file (within 1 s of the wall time before the pause), how long the pause lasted (within 1 s),
 *     and the file is the wall time less the pause (within 1 s).
 *
 * Every notes file is printed and every check is made before the scenario fails, so one run of an
 * older build shows everything it gets wrong.
 */
import path from 'node:path';
import type { Page } from 'puppeteer';
import { z } from 'zod';
import type { MeetingNotesDocument } from '@/lib/notes/parse-meeting-notes';
import {
  currentRecordingId,
  failVideoEncoder,
  inspectWebm,
  listWebm,
  newRecordings,
  openMeeting,
  overlayState,
  pressCardButton,
  probe,
  recordingStartedAt,
  sleep,
  storedRecording,
  waitFor,
} from './harness';
import { notesFor, waitForNotes } from './notes-files';
import type { ScenarioRegistration } from './order-scenarios';
import type { ScenarioContext } from './scenarios';
import { meetingUrl } from './targets';

/** The restart after a failure, and a Stop then Record by the run, come within seconds. */
const MAX_GAP_MS = 15_000;
/** How long the run pauses, and how far a time may be from the one the run measured. */
const PAUSE_MS = 4_000;
const TOLERANCE_MS = 1_000;

const videoModeSchema = z.object({ videoMode: z.string() });
const debugSchema = z.object({ video: z.unknown().nullable() });

interface SavedNotes {
  webm: string;
  document: MeetingNotesDocument;
  text: string;
}

/** The recording the page writes now, once it has the kind of media `video` asks for. */
async function recordingWith(page: Page, video: boolean, other?: string): Promise<string> {
  return waitFor(
    `a recording ${video ? 'with' : 'without'} video`,
    async () => {
      const id = await currentRecordingId(page);
      const debug = debugSchema.safeParse(
        await page.evaluate(() => window.__zenRecorderPage?.debug()),
      );
      const hasVideo = debug.success && debug.data.video !== null;
      return id !== null && id !== other && hasVideo === video ? id : null;
    },
    20_000,
  );
}

/** Waits until recording `id` has a chunk stored, then lets it record `ms` more. */
async function recordFor(page: Page, id: string, ms: number): Promise<void> {
  await waitFor(
    `a chunk of ${id} stored`,
    async () => ((await storedRecording(page, id))?.chunkCount ?? 0) > 0,
    20_000,
  );
  await sleep(ms);
}

/** The notes of the `count` recordings saved since `before`, by recording id. */
async function savedNotes(before: Set<string>, count: number): Promise<Map<string, SavedNotes>> {
  const files = await waitFor(
    `${count} saved file(s)`,
    async () => {
      const saved = await newRecordings(before);
      return saved.length >= count ? saved : null;
    },
    60_000,
  );
  const notes = new Map<string, SavedNotes>();
  for (const webm of files) {
    const { document, text } = await waitForNotes(webm);
    notes.set(document.recording.id, { webm, document, text });
  }
  return notes;
}

/** What a reader sees first: the summary lines, and the timeline as seq, type and position. */
function printNotes({ webm, document, text }: SavedNotes): void {
  const summary = text
    .split('\n')
    .filter((line) => /^- \*\*(Recording|Continues|Started|Ended)/.test(line));
  console.log(`  ${path.basename(notesFor(webm))}:`);
  for (const line of summary) console.log(`    ${line}`);
  const { startCause, audioOnlyReason, continues, media } = document.recording;
  console.log(
    `    recording: ${JSON.stringify({ startCause, media, audioOnlyReason, continues })}`,
  );
  for (const event of document.events) {
    const { seq, type, mediaMs, at, source, ...fields } = event;
    console.log(`    ${seq} ${type} @${mediaMs} ms ${JSON.stringify(fields)}`);
  }
}

/** What the notes of one recording must say about its start, its media and what it continues. */
interface Expected {
  label: string;
  cause: string;
  media: 'video+audio' | 'audio';
  audioOnlyReason: string | null;
  continues: { id: string; webm: string } | null;
}

type Continues = MeetingNotesDocument['recording']['continues'];

/** A link to the file `expected` names, with a gap of a few seconds at most; none when null. */
function checkContinues(actual: Continues, expected: Expected['continues']): string[] {
  if (expected === null) return actual === null ? [] : [`continues ${JSON.stringify(actual)}`];
  const file = path.basename(expected.webm);
  const linked = actual?.recordingId === expected.id && actual.file === file;
  const gapMs = actual?.gapMs ?? Number.NaN;
  return linked && gapMs <= MAX_GAP_MS ? [] : [`continues ${JSON.stringify(actual)}, not ${file}`];
}

const same = (label: string, actual: unknown, expected: unknown): string[] =>
  actual === expected ? [] : [`${label} ${String(actual)}, not ${String(expected)}`];

function checkStart(notes: SavedNotes | undefined, expected: Expected): string[] {
  if (!notes) return [`${expected.label}: no notes`];
  const { recording, events } = notes.document;
  const started = events.find((event) => event.type === 'recording-started');
  const eventCause = started?.type === 'recording-started' ? started.cause : undefined;
  const problems = [
    ...same('started', recording.startCause, expected.cause),
    ...same('the start event says started', eventCause, expected.cause),
    ...same('media', recording.media, expected.media),
    ...same('audio only for', recording.audioOnlyReason, expected.audioOnlyReason),
    ...checkContinues(recording.continues, expected.continues),
  ];
  return problems.map((problem) => `${expected.label}: ${problem}`);
}

/** The first file's video failed: its timeline says so right before its stop. */
function checkVideoFailed(notes: SavedNotes | undefined): string[] {
  const types = notes?.document.events.map((event) => event.type) ?? [];
  const stop = notes?.document.events.at(-1);
  const failedThenStopped =
    types.at(-2) === 'video-failed' &&
    stop?.type === 'recording-stopped' &&
    stop.reason === 'encoder-error';
  return failedThenStopped ? [] : [`first file: the timeline ends ${types.slice(-2).join(', ')}`];
}

/** One call: auto start with video, a video failure, Stop then Record. */
async function splitCall(context: ScenarioContext): Promise<string[]> {
  const { browser, target } = context;
  const before = new Set(await listWebm());
  const page = await openMeeting(browser, meetingUrl(target));
  try {
    await page.bringToFront();
    await page.click('#start');
    const first = await recordingWith(page, true);
    await recordFor(page, first, 3_000);
    await failVideoEncoder(page, 'injected by the e2e run');
    const second = await recordingWith(page, false, first);
    await recordFor(page, second, 2_000);
    await pressCardButton(page, 'Stop');
    await waitFor(
      'stopped, with Record on the card',
      async () => ['waiting', 'idle'].includes((await overlayState(page)) ?? ''),
      10_000,
    );
    await pressCardButton(page, 'Record');
    const third = await recordingWith(page, false, second);
    await recordFor(page, third, 2_000);
    await page.evaluate(() => window.__fixture.hangup());
    const notes = await savedNotes(before, 3);
    for (const id of [first, second, third]) {
      const saved = notes.get(id);
      if (saved) printNotes(saved);
    }
    const webm = (id: string) => notes.get(id)?.webm ?? '(no file)';
    return [
      ...checkStart(notes.get(first), {
        label: 'first file',
        cause: 'auto-first-remote',
        media: 'video+audio',
        audioOnlyReason: null,
        continues: null,
      }),
      ...checkVideoFailed(notes.get(first)),
      ...checkStart(notes.get(second), {
        label: 'second file',
        cause: 'restart-after-video-failure',
        media: 'audio',
        audioOnlyReason: 'video-failed',
        continues: { id: first, webm: webm(first) },
      }),
      ...checkStart(notes.get(third), {
        label: 'third file',
        cause: 'manual',
        media: 'audio',
        audioOnlyReason: 'video-failed',
        continues: { id: second, webm: webm(second) },
      }),
    ];
  } finally {
    await page.close();
  }
}

/** A call in a new tab with video off: audio only because of the setting, continuing nothing. */
async function videoOff(context: ScenarioContext): Promise<string[]> {
  const { browser, target } = context;
  const before = new Set(await listWebm());
  const page = await openMeeting(browser, meetingUrl(target));
  try {
    const result = videoModeSchema.safeParse(await probe(page, 'settings:video-off'));
    if (!result.success || result.data.videoMode !== 'off') {
      throw new Error('could not switch video off through the debug probe');
    }
    await page.bringToFront();
    await page.click('#start');
    const id = await recordingWith(page, false);
    await recordFor(page, id, 2_000);
    await page.evaluate(() => window.__fixture.hangup());
    const notes = await savedNotes(before, 1);
    const saved = notes.get(id);
    if (saved) printNotes(saved);
    return checkStart(saved, {
      label: 'video off',
      cause: 'auto-first-remote',
      media: 'audio',
      audioOnlyReason: 'setting-off',
      continues: null,
    });
  } finally {
    await probe(page, 'settings:video-on');
    await page.close();
  }
}

/** The run's own clock around a pause: when it pressed each button, and when the file began. */
interface PauseClock {
  startedAt: number;
  pausedAt: number;
  resumedAt: number;
  stoppedAt: number;
}

const near = (label: string, actual: number | undefined, expected: number): string[] =>
  actual !== undefined && Math.abs(actual - expected) <= TOLERANCE_MS
    ? []
    : [`${label} ${String(actual)} ms, not ${expected} ms`];

/** The pause and the resume, where the pause cut the file and how long it lasted. */
function checkPause(notes: SavedNotes | undefined, clock: PauseClock, fileMs: number): string[] {
  const events = notes?.document.events ?? [];
  const paused = events.find((event) => event.type === 'recording-paused');
  const resumed = events.find((event) => event.type === 'recording-resumed');
  const pausedMs = resumed?.type === 'recording-resumed' ? resumed.pausedMs : undefined;
  const cut = clock.pausedAt - clock.startedAt;
  const wallMs = clock.stoppedAt - clock.startedAt;
  const problems = [
    ...near('the pause is at', paused?.mediaMs, cut),
    ...near('the resume is at', resumed?.mediaMs, cut),
    ...near('the pause lasted', pausedMs, clock.resumedAt - clock.pausedAt),
    ...near('the notes say paused for', notes?.document.recording.pausedMs, pausedMs ?? 0),
    ...near('the file lasts', fileMs, wallMs - (pausedMs ?? 0)),
  ];
  return problems.map((problem) => `paused call: ${problem}`);
}

/** A call paused for 4 s, then stopped. */
async function pausedCall(context: ScenarioContext): Promise<string[]> {
  const { browser, target } = context;
  const before = new Set(await listWebm());
  const page = await openMeeting(browser, meetingUrl(target));
  try {
    await page.bringToFront();
    await page.click('#start');
    const id = await recordingWith(page, true);
    await recordFor(page, id, 3_000);
    const startedAt = await recordingStartedAt(page);
    const pausedAt = Date.now();
    await pressCardButton(page, 'Pause');
    await waitFor('paused', async () => (await overlayState(page)) === 'paused', 10_000);
    await sleep(PAUSE_MS);
    const resumedAt = Date.now();
    await pressCardButton(page, 'Resume');
    await waitFor(
      'recording again',
      async () => (await overlayState(page)) === 'recording',
      10_000,
    );
    await sleep(3_000);
    const stoppedAt = Date.now();
    await pressCardButton(page, 'Stop');
    await page.evaluate(() => window.__fixture.hangup());
    const saved = (await savedNotes(before, 1)).get(id);
    if (saved) printNotes(saved);
    const fileMs = saved ? (await inspectWebm(saved.webm)).durationS * 1000 : 0;
    const clock = { startedAt, pausedAt, resumedAt, stoppedAt };
    console.log(`  paused call: ${JSON.stringify(clock)}, file ${fileMs.toFixed(0)} ms`);
    return checkPause(saved, clock, fileMs);
  } finally {
    await page.close();
  }
}

async function scenarioNotesLifecycle(context: ScenarioContext): Promise<void> {
  console.log(
    `▶ ${context.target.id} scenario 96: the notes say why each recording started, what it records and which file it continues`,
  );
  const problems = [
    ...(await splitCall(context)),
    ...(await videoOff(context)),
    ...(await pausedCall(context)),
  ];
  if (problems.length > 0) throw new Error(problems.join('; '));
}

export const registration = {
  name: '96',
  after: '90',
  scenario: scenarioNotesLifecycle,
} satisfies ScenarioRegistration;
