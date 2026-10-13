/**
 * E2e scenario 99, run against every provider's fixture page right after scenario 96: the meeting
 * notes say who was in the call, who joined, left and shared a screen, each where it happened in
 * the file.
 *
 * In a call that records by itself, someone joins under an invented name with a character the
 * notes must escape, shares a screen for 3 s and leaves; 3 s later the run pauses for 4 s and
 * resumes, then the user shares a screen from a click (Firefox shares only from one) and the page
 * stops it 3 s later with `track.stop()`, which fires no event. The notes must list the user as
 * themselves (also where the page cannot tell which tile is the user's) and the person in the call
 * from the start as there at both ends; the newcomer joined and left where the page made them
 * happen, within 1.5 s, in the data, in the participants table and in the timeline. Where the
 * page shows who shares (Zoom, Teams) the newcomer's share is theirs, where the page made it
 * happen; where it does not (Meet) no row tells another's share and the notes say shares were not
 * observable. The user's own share is told once, by the user, on every service, its times taken
 * off the pause. The timeline tells it all in the order it happened, although a leave is written
 * only once it held 10 s. Last, the user mutes for 2 s: where the page shows the microphone (Zoom,
 * Teams) that is a mute and an unmute, each written once it held 1 s; where it does not (Meet), the
 * recording's own rule writes nothing under 4 s. Every position lies within the saved file. Each
 * fake page counts the people in the call and shows all of them, so every service names who came
 * and went.
 *
 * The page can freeze. On the Zoom fixture, Firefox can block the page's main thread on a snapshot
 * of a canvas its worker paints, for its 10 s snapshot timeout, most often as a new canvas appears
 * (the newcomer's share); the page sees nothing meanwhile. So each moment is read by the page's own
 * clock in the task that makes the change, each state lasts for a time the page ran, and a position
 * may also lie within 1.5 s of the moment the page ran again after a freeze that held the change.
 * The freezes come from the recorder's own Diagnostics lines.
 *
 * Every check is made before the scenario fails, so one run of an older build shows everything it
 * gets wrong, and the notes' people and timeline are printed.
 */
import path from 'node:path';
import type { Page } from 'puppeteer';
import type { MeetingNotesDocument, NotesEvent } from '@/lib/notes/parse-meeting-notes';
import {
  currentRecordingId,
  ffprobe,
  inspectWebm,
  listWebm,
  openMeeting,
  overlayState,
  pressCardButton,
  probe,
  recordingStartedAt,
  sleep,
  storedRecording,
  waitFor,
  waitForNewRecording,
} from './harness';
import { type CanvasFreeze, judgeSeenAt } from './judge-seen-at';
import { letPageRun } from './let-page-run';
import { waitForNotes } from './notes-files';
import type { ScenarioContext, ScenarioRegistration } from './order-scenarios';
import { readCanvasFreezes } from './read-canvas-freezes';
import { type FixtureTarget, meetingUrl } from './targets';

/** Someone who joins the call, named the way people name themselves at work. */
const NEWCOMER = 'Chloé Martin | Design';
const STAY_MS = 3_000;
const PAUSE_MS = 4_000;
/** How far a position may be from where the run made it happen: the page reads once a second. */
const TOLERANCE_MS = 1_500;

/** When the page made each thing happen, in ms from the start of the file by its own clock. */
interface Clock {
  joinedAt: number;
  sharedAt: number;
  unsharedAt: number;
  leftAt: number;
  pausedAt: number;
  resumedAt: number;
  /** The user's own share, after the pause: its place in the file is this less the pause. */
  ownSharedAt: number;
  ownStoppedAt: number;
  /** The user's 2 s mute, after the pause too. */
  mutedAt: number;
  unmutedAt: number;
}

/** The notes of one recording, its saved file's length, and when canvas snapshots froze the page. */
interface Saved {
  document: MeetingNotesDocument;
  text: string;
  md: string;
  fileMs: number;
  freezes: CanvasFreeze[];
  clock: Clock;
}

/** The section of the notes under `heading`, up to the next one. */
const section = (text: string, heading: string): string[] => {
  const lines = text.split('\n');
  const from = lines.findIndex((line) => line.startsWith(heading));
  const to = lines.findIndex((line, index) => index > from && line.startsWith('## '));
  return from === -1 ? [] : lines.slice(from, to === -1 ? undefined : to);
};

function printNotes({ md, text, document }: Saved): void {
  console.log(`  ${path.basename(md)}:`);
  for (const line of [...section(text, '## Participants'), ...section(text, '## Timeline')]) {
    if (line !== '') console.log(`    ${line}`);
  }
  for (const { seq, type, mediaMs, at, source, ...fields } of document.events) {
    console.log(`    ${seq} ${type} @${mediaMs} ms ${JSON.stringify(fields)}`);
  }
}

/** The recording the call started, once its first chunk is stored. */
async function recordingOf(page: Page): Promise<string> {
  const id = await waitFor('the recording', () => currentRecordingId(page), 20_000);
  await waitFor(
    `a chunk of ${id} stored`,
    async () => ((await storedRecording(page, id))?.chunkCount ?? 0) > 0,
    20_000,
  );
  return id;
}

/** Waits until the card shows `state`. */
const cardSays = (page: Page, state: string) =>
  waitFor(`the card saying ${state}`, async () => (await overlayState(page)) === state, 10_000);

/** What the run has the fake page do, by the fixture's own calls. */
type Step = 'join' | 'share' | 'unshare' | 'leave' | 'stopScreenShare' | 'mute' | 'unmute';

/**
 * Has the page do `step` and returns when it did, by the page's own clock, in ms into the file
 * that started at `startedAt`: a page that froze does it only once it runs again.
 */
const stepAt = async (page: Page, startedAt: number, step: Step): Promise<number> =>
  // A switch, not functions: the run's TypeScript transform names every function it builds with a
  // helper the page does not have.
  (await page.evaluate(
    (what, name) => {
      const fixture = window.__fixture;
      switch (what) {
        case 'join':
          fixture.addParticipant({ name });
          break;
        case 'share':
          fixture.startShare(name);
          break;
        case 'unshare':
          fixture.stopShare();
          break;
        case 'leave':
          fixture.removeParticipant(name);
          break;
        case 'stopScreenShare':
          fixture.stopScreenShare();
          break;
        case 'mute':
          fixture.mute();
          break;
        case 'unmute':
          fixture.unmute();
          break;
      }
      return Date.now();
    },
    step,
    NEWCOMER,
  )) - startedAt;

/** Waits until the page has run for `ms` since the run last changed something in it. */
const runFor = (page: Page, ms: number) =>
  letPageRun(ms, { ping: () => page.evaluate(() => 0), now: () => Date.now(), sleep });

/** The user shares a screen from a click for 3 s; the page stops it. Its start and stop times. */
async function shareOwnScreen(page: Page, startedAt: number) {
  const ownSharedAt = (await page.evaluate(() => Date.now())) - startedAt;
  await page.click('#share-screen');
  await waitFor(
    'the own share',
    () => page.evaluate(() => window.__fixture.sharingScreen()),
    10_000,
  );
  await runFor(page, STAY_MS);
  const ownStoppedAt = await stepAt(page, startedAt, 'stopScreenShare');
  return { ownSharedAt, ownStoppedAt };
}

/** The call: someone joins, shares and leaves, a pause, the user shares, then the stop. */
async function peopleCall({ browser, target }: ScenarioContext): Promise<Saved> {
  const before = new Set(await listWebm());
  const page = await openMeeting(browser, meetingUrl(target));
  try {
    await page.bringToFront();
    await page.click('#start');
    await recordingOf(page);
    await runFor(page, 2_000);
    const startedAt = await recordingStartedAt(page);
    // The page's own clock, read in the task that makes each change, or right before a click.
    const since = async () => (await page.evaluate(() => Date.now())) - startedAt;
    const joinedAt = await stepAt(page, startedAt, 'join');
    await runFor(page, STAY_MS);
    const sharedAt = await stepAt(page, startedAt, 'share');
    await runFor(page, STAY_MS);
    const unsharedAt = await stepAt(page, startedAt, 'unshare');
    const leftAt = await stepAt(page, startedAt, 'leave');
    await runFor(page, STAY_MS);
    const pausedAt = await since();
    await pressCardButton(page, 'Pause');
    await cardSays(page, 'paused');
    await runFor(page, PAUSE_MS);
    const resumedAt = await since();
    await pressCardButton(page, 'Resume');
    await cardSays(page, 'recording');
    await runFor(page, 2_000);
    const own = await shareOwnScreen(page, startedAt);
    await runFor(page, 1_000);
    const mutedAt = await stepAt(page, startedAt, 'mute');
    await runFor(page, 2_000);
    const unmutedAt = await stepAt(page, startedAt, 'unmute');
    await runFor(page, STAY_MS);
    await pressCardButton(page, 'Stop');
    const webm = await waitForNewRecording(before);
    const { md, text, document } = await waitForNotes(webm);
    const fileMs = (await inspectWebm(webm)).durationS * 1000;
    const clock = {
      ...{ joinedAt, sharedAt, unsharedAt, leftAt, pausedAt, resumedAt },
      ...{ ...own, mutedAt, unmutedAt },
    };
    console.log(`  the page's clock at each step, ms into the file: ${JSON.stringify(clock)}`);
    console.log(`  ${path.basename(webm)}: ${fileMs.toFixed(0)} ms; ffprobe: ${ffprobe(webm)}`);
    const freezes = readCanvasFreezes(await probe(page, 'diagnostics'), startedAt);
    if (freezes.length > 0) {
      const spans = freezes.map((freeze) => `${freeze.from}-${freeze.to}`).join(', ');
      console.log(`  canvas snapshots froze the page, ms into the file: ${spans}`);
    }
    return { document, text, md, fileMs, clock, freezes };
  } finally {
    await page.evaluate(() => window.__fixture.hangup());
    await page.close();
  }
}

const same = (label: string, actual: unknown, expected: unknown): string[] =>
  actual === expected
    ? []
    : [`${label} ${JSON.stringify(actual)}, not ${JSON.stringify(expected)}`];

/** Judges where the notes place something the run made happen (`Saved.clock`). */
type Seen = (
  label: string,
  actual: number | null | undefined,
  at: number,
  afterPause?: boolean,
) => string[];

/**
 * Within 1.5 s of the moment, or of the moment the page ran again after a canvas freeze that held
 * it. After the pause, the moment and the freezes lie earlier in the file by the pause the notes
 * cut out of it: a freeze can delay the Pause or the Resume, and the file pauses when the page does.
 */
const seenIn =
  ({ document, freezes }: Saved): Seen =>
  (label, actual, at, afterPause = false) => {
    const cut = afterPause ? document.recording.pausedMs : 0;
    return judgeSeenAt({
      label,
      actual: actual ?? undefined,
      at: at - cut,
      tolerance: TOLERANCE_MS,
      freezes: freezes.map(({ from, to }) => ({ from: from - cut, to: to - cut })),
    });
  };

/** The people: the user, the person there from the start, the newcomer's one span. */
function checkParticipants(saved: Saved, target: FixtureTarget, seen: Seen) {
  const { participants } = saved.document;
  const user = participants.find((participant) => participant.self === true);
  const remote = participants.find((participant) => participant.name === target.names.remote);
  const newcomer = participants.find((participant) => participant.name === NEWCOMER);
  const span = newcomer?.spans[0];
  return [
    ...same('the user', user ? 'listed' : 'missing', 'listed'),
    ...same('the user is p1:', user?.id, 'p1'),
    ...same('their name', user?.name ?? null, target.supports.self ? target.names.self : null),
    ...same(`${target.names.remote} there at the start:`, remote?.presentAtStart, true),
    ...same(`${target.names.remote} there at the end:`, remote?.presentAtEnd, true),
    ...same('the newcomer there at the start:', newcomer?.presentAtStart, false),
    ...same('the newcomer there at the end:', newcomer?.presentAtEnd, false),
    ...same('the newcomer in spans:', newcomer?.spans.length, 1),
    ...seen('the newcomer joined at', span?.joinedMs, saved.clock.joinedAt),
    ...seen('the newcomer left at', span?.leftMs, saved.clock.leftAt),
    ...same('joins and leaves are', saved.document.capture.signals.joinLeave, 'observed'),
  ];
}

/** Who an event is about: the participant who joined or left, or who shared. */
const whoOf = (event: NotesEvent): string | null => {
  if ('participant' in event) return event.participant;
  return 'by' in event ? event.by : null;
};

/** Where the first `type` about `id` is in the file (any, without an id). */
const positionOf = (events: readonly NotesEvent[], type: string, id?: string) =>
  events.find((event) => event.type === type && (id === undefined || whoOf(event) === id))?.mediaMs;

/**
 * The shares: the newcomer's where the page shows who shares, none of anyone else's where it
 * does not, and the user's own once, by the user, its times less the pause.
 */
function checkShares({ document, clock }: Saved, target: FixtureTarget, seen: Seen): string[] {
  const { events, capture } = document;
  const id = document.participants.find((participant) => participant.name === NEWCOMER)?.id;
  const starts = events.filter((event) => event.type === 'share-started').map(whoOf);
  const others = starts.filter((who) => who !== 'p1').length;
  const remote = target.supports.shareBy
    ? [
        ...seen('the newcomer shared at', positionOf(events, 'share-started', id), clock.sharedAt),
        ...seen('their share ended at', positionOf(events, 'share-stopped', id), clock.unsharedAt),
        ...same("others' shares told", others, 1),
      ]
    : [
        ...same("others' shares told", others, 0),
        ...same('shares are', capture.signals.share, 'not-available'),
      ];
  const own = target.supports.selfShare
    ? [
        ...seen(
          'you shared at',
          positionOf(events, 'share-started', 'p1'),
          clock.ownSharedAt,
          true,
        ),
        ...seen(
          'you stopped at',
          positionOf(events, 'share-stopped', 'p1'),
          clock.ownStoppedAt,
          true,
        ),
        ...same('your shares told', starts.filter((who) => who === 'p1').length, 1),
      ]
    : [];
  return [...remote, ...own];
}

/**
 * The 2 s mute: muted then on again where the page shows the microphone, held 1 s each; nothing
 * where the recording's own state decides, which must hold 4 s.
 */
function checkMicrophone({ document, clock }: Saved, target: FixtureTarget, seen: Seen) {
  const mic = document.events.flatMap((event) => (event.type === 'mic' ? [event] : []));
  if (!target.supports.micStates) return same('microphone rows', mic.length, 0);
  return [
    ...same('the microphone went', mic.map((event) => event.state).join(' '), 'muted live'),
    ...seen('muted at', mic[0]?.mediaMs, clock.mutedAt, true),
    ...seen('on again at', mic[1]?.mediaMs, clock.unmutedAt, true),
  ];
}

/** The rows of the timeline the run made happen, in the order it made them. */
function rowsInOrder(text: string, target: FixtureTarget): string[] {
  const rows = section(text, '## Timeline');
  const escaped = NEWCOMER.replace('|', '\\|');
  const expected = [
    `Joined: ${escaped}`,
    ...(target.supports.shareBy
      ? [`${escaped} started sharing`, `${escaped} stopped sharing`]
      : []),
    `Left: ${escaped}`,
    'You paused',
    'You resumed',
    ...(target.supports.selfShare ? ['You started sharing', 'You stopped sharing'] : []),
  ];
  const at = expected.map((words) => rows.findIndex((line) => line.includes(words)));
  const ordered = at.every((index, place) => index > (at[place - 1] ?? 0));
  return ordered ? [] : [`the timeline's rows ${JSON.stringify(expected)} are at ${at.join(', ')}`];
}

/**
 * The timeline: the join, the leave and the pause where the run made them, in that order. The
 * pause ends where the notes place it plus the time they say it lasted, by the page's clock.
 */
function checkTimeline(saved: Saved, target: FixtureTarget, seen: Seen) {
  const { document, text, fileMs, clock } = saved;
  const { events } = document;
  const id = document.participants.find((participant) => participant.name === NEWCOMER)?.id;
  const beyond = events.filter((event) => event.mediaMs > fileMs + TOLERANCE_MS);
  const resumed = positionOf(events, 'recording-resumed');
  const pauseEnded = resumed === undefined ? undefined : resumed + document.recording.pausedMs;
  return [
    ...seen('joined at', positionOf(events, 'participant-joined', id), clock.joinedAt),
    ...seen('left at', positionOf(events, 'participant-left', id), clock.leftAt),
    ...seen('paused at', positionOf(events, 'recording-paused'), clock.pausedAt),
    ...seen('resumed at', resumed, clock.pausedAt),
    ...seen('the pause ended at', pauseEnded, clock.resumedAt),
    ...rowsInOrder(text, target),
    ...same('events past the end of the file', beyond.map((event) => event.type).join(), ''),
  ];
}

async function scenarioPeopleAndShares(context: ScenarioContext): Promise<void> {
  console.log(
    `▶ ${context.target.id} scenario 99: the notes say who was in the call, who joined, left and shared, where it happened`,
  );
  const saved = await peopleCall(context);
  printNotes(saved);
  const seen = seenIn(saved);
  const problems = [
    ...checkParticipants(saved, context.target, seen),
    ...checkShares(saved, context.target, seen),
    ...checkMicrophone(saved, context.target, seen),
    ...checkTimeline(saved, context.target, seen),
  ];
  if (problems.length > 0) throw new Error(problems.join('; '));
}

export const registration = {
  name: '99',
  after: '96',
  scenario: scenarioPeopleAndShares,
} satisfies ScenarioRegistration;
