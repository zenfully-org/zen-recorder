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
 *   - A call with the visibility spoof on (the page believes it is visible): the start says the
 *     microphone was on and the tab visible; a 5 s mute is written as muted then on again, the tab
 *     hidden behind another for 3 s as a span where people may be missing, and a new title once it
 *     held 5 s, each within 1 s of when the run made it happen, or of when the page could run again:
 *     on the Zoom fixture, Firefox can freeze the page on a snapshot of the canvas its worker
 *     paints, for its 10 s snapshot timeout, as the tab is hidden or shown, and the page sees
 *     nothing meanwhile. The freezes come from the recorder's own Diagnostics lines, and each
 *     state lasts for a time the page ran, so it holds in the page as long as the run meant.
 *
 * Every notes file is printed and every check is made before the scenario fails, so one run of an
 * older build shows everything it gets wrong.
 */
import path from 'node:path';
import type { Page } from 'puppeteer';
import { z } from 'zod';
import type { MeetingNotesDocument } from '@/lib/notes/parse-meeting-notes';
import { evaluateInChrome } from './evaluate-in-chrome';
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
import { type CanvasFreeze, judgeSeenAt } from './judge-seen-at';
import { letPageRun } from './let-page-run';
import { waitForNotes } from './notes-files';
import type { ScenarioContext, ScenarioRegistration } from './order-scenarios';
import { readCanvasFreezes } from './read-canvas-freezes';
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
  md: string;
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
    const { md, document, text } = await waitForNotes(webm);
    notes.set(document.recording.id, { webm, md, document, text });
  }
  return notes;
}

/** What a reader sees first: the summary lines, and the timeline as seq, type and position. */
function printNotes({ md, document, text }: SavedNotes): void {
  const summary = text
    .split('\n')
    .filter((line) =>
      /^- \*\*(Recording|Continues|Recorded|Started|Ended|Your microphone)/.test(line),
    );
  console.log(`  ${path.basename(md)}:`);
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

/**
 * The first file's video failed: its timeline says so right before its stop, the reading of who
 * was in the call at the stop aside (a reading has no row).
 */
function checkVideoFailed(notes: SavedNotes | undefined): string[] {
  const told = notes?.document.events.filter((event) => event.type !== 'roster') ?? [];
  const types = told.map((event) => event.type);
  const stop = told.at(-1);
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

const near = (
  label: string,
  actual: number | undefined,
  expected: number,
  tolerance = TOLERANCE_MS,
): string[] =>
  actual !== undefined && Math.abs(actual - expected) <= tolerance
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

/** When the run made each thing happen, by its own clock, from the start of the file. */
interface SignalClock {
  mutedAt: number;
  unmutedAt: number;
  coveredAt: number;
  shownAt: number;
  renamedAt: number;
}

const RENAMED = 'Renamed planning';

/**
 * The start's states, the mute, the covered tab and the title, where the run made them, or where
 * the page could see them once a canvas snapshot no longer froze it.
 */
function checkSignals(
  notes: SavedNotes | undefined,
  at: SignalClock,
  freezes: readonly CanvasFreeze[],
): string[] {
  const seen = (label: string, actual: number | undefined, moment: number, tolerance: number) =>
    judgeSeenAt({ label, actual, at: moment, tolerance, freezes });
  const tickLatency = notes?.document.capture.detectionLatencyMs ?? 0;
  const events = notes?.document.events ?? [];
  const started = events.find((event) => event.type === 'recording-started');
  const states =
    started?.type === 'recording-started' ? `${started.mic} ${started.tabVisible}` : '';
  const mic = events.flatMap((event) => (event.type === 'mic' ? [event] : []));
  const where = (type: string) => events.find((event) => event.type === type)?.mediaMs;
  const title = events.find((event) => event.type === 'title-changed');
  const coverage = notes?.document.capture.coverage.find((span) => span.reason === 'tab-hidden');
  const problems = [
    ...same('the start says', states, 'live true'),
    ...same('the microphone went', mic.map((event) => event.state).join(' '), 'muted live'),
    ...seen('muted at', mic[0]?.mediaMs, at.mutedAt, TOLERANCE_MS),
    ...seen('on again at', mic[1]?.mediaMs, at.unmutedAt, TOLERANCE_MS),
    ...seen('the tab hidden at', where('coverage-lost'), at.coveredAt, TOLERANCE_MS),
    ...seen('the tab shown at', where('coverage-restored'), at.shownAt, TOLERANCE_MS),
    ...same('the hidden span covers', coverage?.signal, 'participants'),
    ...same('the title became', title?.type === 'title-changed' ? title.title : undefined, RENAMED),
    // The page reads the title once a tick, the latency the notes state, after the run's own call.
    ...seen('the title changed at', title?.mediaMs, at.renamedAt, tickLatency + TOLERANCE_MS / 2),
  ];
  return problems.map((problem) => `signals call: ${problem}`);
}

/**
 * Selects the tab showing `url` in the browser window, from the chrome scope. Not through
 * WebDriver BiDi: Firefox's `browsingContext.activate` and `create` wait for the tab they hide to
 * report `visibilitychange`, which the visibility spoof keeps from them, and so wait for good.
 */
async function selectTab(browser: object, url: string): Promise<void> {
  await evaluateInChrome(
    browser,
    `(() => {
      const { gBrowser } = Services.wm.getMostRecentWindow('navigator:browser');
      const tab = gBrowser.tabs.find((t) => t.linkedBrowser.currentURI.spec === ${JSON.stringify(url)});
      if (!tab) throw new Error('no tab shows ${url}');
      gBrowser.selectedTab = tab;
      return true;
    })()`,
  );
}

/**
 * A call with the spoof on: a mute, the tab hidden behind another, a new title. The other tab is
 * opened before the recording installs the spoof, and the tabs are switched from the chrome scope.
 * Each state lasts for a time the page ran (`letPageRun`), so it holds as long in the page's eyes.
 */
async function signalsCall(context: ScenarioContext): Promise<string[]> {
  const { browser, target } = context;
  const before = new Set(await listWebm());
  const page = await openMeeting(browser, meetingUrl(target));
  await probe(page, 'settings:spoof-on');
  const cover = await browser.newPage();
  await cover.goto('about:blank');
  try {
    await page.bringToFront();
    await page.click('#start');
    const id = await recordingWith(page, true);
    await recordFor(page, id, 2_000);
    const startedAt = await recordingStartedAt(page);
    const since = () => Date.now() - startedAt;
    const runFor = (ms: number) =>
      letPageRun(ms, { ping: () => page.evaluate(() => 0), now: () => Date.now(), sleep });
    const mutedAt = since();
    await page.evaluate(() => window.__fixture.mute());
    await runFor(5_000);
    const unmutedAt = since();
    await page.evaluate(() => window.__fixture.unmute());
    await runFor(5_000);
    const coveredAt = since();
    await selectTab(browser, 'about:blank');
    await runFor(3_000);
    const shownAt = since();
    await selectTab(browser, page.url());
    const renamedAt = since();
    await page.evaluate((title) => window.__fixture.setTitle(title), RENAMED);
    await runFor(7_000);
    await pressCardButton(page, 'Stop');
    await page.evaluate(() => window.__fixture.hangup());
    const saved = (await savedNotes(before, 1)).get(id);
    if (saved) printNotes(saved);
    const clock = { mutedAt, unmutedAt, coveredAt, shownAt, renamedAt };
    console.log(`  signals call, ms into the file by the run's clock: ${JSON.stringify(clock)}`);
    const freezes = readCanvasFreezes(await probe(page, 'diagnostics'), startedAt);
    if (freezes.length > 0) {
      const spans = freezes.map((freeze) => `${freeze.from}-${freeze.to}`).join(', ');
      console.log(`  canvas snapshots froze the page, ms into the file: ${spans}`);
    }
    return checkSignals(saved, clock, freezes);
  } finally {
    await probe(page, 'settings:spoof-off');
    await page.close();
    await cover.close();
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
    ...(await signalsCall(context)),
  ];
  if (problems.length > 0) throw new Error(problems.join('; '));
}

export const registration = {
  name: '96',
  after: '90',
  scenario: scenarioNotesLifecycle,
} satisfies ScenarioRegistration;
